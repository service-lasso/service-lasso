#define UNICODE
#define _UNICODE
#define _WIN32_WINNT 0x0601
#include <windows.h>
#include <bcrypt.h>
#include <stdio.h>
#include <wchar.h>
#include <stdlib.h>

#pragma comment(lib, "bcrypt.lib")

/*
 * This is deliberately a native PE boundary.  It runs before a CLR is loaded,
 * removes CLR loader controls, holds the reviewed managed launcher by handle,
 * and only then starts the managed component that owns launch semantics.
 */
#define MANAGED_LAUNCHER_NAME L"windows-managed-launcher-managed.exe"
#define PACKAGE_DIRECTORY_HANDLE_CAPACITY 128
#define MANAGED_LAUNCHER_BYTE_LENGTH 39936LL
static const unsigned char MANAGED_LAUNCHER_SHA256[32] = {
  0xff, 0x1f, 0x7f, 0xdf, 0x44, 0xa4, 0x41, 0x9f,
  0x68, 0x1e, 0x5c, 0xd7, 0xfe, 0x23, 0xbd, 0x59,
  0xb4, 0x95, 0x15, 0x3a, 0xd6, 0x34, 0x2c, 0xcd,
  0x32, 0x1d, 0x2c, 0x36, 0xde, 0x32, 0x28, 0xfa
};

enum {
  BOOTSTRAP_FAILURE_UNKNOWN = 100,
  BOOTSTRAP_FAILURE_BINDING = 124,
  BOOTSTRAP_FAILURE_CREATE = 125,
  BOOTSTRAP_FAILURE_WAIT = 126
};

/* Opt-in ConPTY custody only. Generic service and DIRECTORY_SYNC callers do
 * not supply this interface and retain their existing launch semantics. */
typedef struct { const char* site; DWORD status; int native, failure; } ConptyObservation;
typedef struct ConptyReadOwner {
  struct ConptyReadOwner* next;
  OVERLAPPED operation;
  char byte;
  DWORD read;
  int issued, completed, cancelAttempted, closeAttempted, closed;
  unsigned observations;
  ConptyObservation ledger[10];
} ConptyReadOwner;
typedef struct {
  HANDLE pipe;
  HANDLE job;
  HANDLE owner;
  HANDLE stopEvent;
  wchar_t token[65];
  volatile LONG cancelled;
  volatile LONG failed;
  volatile LONG stopping;
  ConptyReadOwner* reads;
  void (*observeFailure)(void*, const char*, DWORD, int);
  void* observationOwner;
  ConptyObservation containment[8];
  unsigned containmentCount;
  int containmentStop, containmentDrain, containmentReader, containmentProcess;
} ConptyControl;

static void ObserveConpty(ConptyControl* control, ConptyObservation* ledger, unsigned* count,
    unsigned capacity, const char* site, DWORD status, int native, int failure) {
  if (*count >= capacity) { for (;;) Sleep(INFINITE); }
  ledger[*count].site = site; ledger[*count].status = status;
  ledger[*count].native = native; ledger[(*count)++].failure = failure;
  if (failure) {
    InterlockedExchange(&control->failed, 1);
    if (control->observeFailure) control->observeFailure(control->observationOwner,site,status,native);
  }
}
static void RetainConpty(void) { for (;;) Sleep(INFINITE); }
#define READ_OBSERVE(site, status, native, failure) ObserveConpty(control, owner->ledger, &owner->observations, _countof(owner->ledger), site, status, native, failure)
static int ReadControlByte(ConptyControl* control, char* byte, DWORD* read) {
  ConptyReadOwner* owner = (ConptyReadOwner*)HeapAlloc(GetProcessHeap(),HEAP_ZERO_MEMORY,sizeof(*owner));
  if (!owner) {
    /* HeapAlloc supplies no GetLastError contract. Preserve an explicit non-native failure. */
    InterlockedExchange(&control->failed,1);
    if (control->observeFailure) control->observeFailure(control->observationOwner,"read-owner-allocation",ERROR_NOT_ENOUGH_MEMORY,0);
    return -1;
  }
  owner->next = control->reads; control->reads = owner;
  owner->operation.hEvent = CreateEventW(NULL, TRUE, FALSE, NULL);
  DWORD eventError = owner->operation.hEvent ? 0 : GetLastError();
  READ_OBSERVE("read-create-event",eventError,1,!owner->operation.hEvent);
  if (!owner->operation.hEvent) return -1;
  int result = 0;
  DWORD stop = WaitForSingleObject(control->stopEvent, 0);
  DWORD stopError = stop == WAIT_FAILED ? GetLastError() : stop;
  READ_OBSERVE("read-stop-observation",stopError,stop == WAIT_FAILED,stop != WAIT_TIMEOUT && stop != WAIT_OBJECT_0);
  if (stop != WAIT_TIMEOUT) { if (stop != WAIT_OBJECT_0) result = -1; goto completed; }
  BOOL issued = ReadFile(control->pipe, &owner->byte, 1, &owner->read, &owner->operation);
  DWORD issueError = issued ? 0 : GetLastError();
  int eof = !issued && (issueError == ERROR_BROKEN_PIPE || issueError == ERROR_HANDLE_EOF || issueError == ERROR_NO_DATA);
  READ_OBSERVE("read-issuance",issueError,1,!issued && issueError != ERROR_IO_PENDING && !eof);
  if (issued) {
    owner->issued = 1; owner->completed = 1; result = owner->read == 1;
  } else if (issueError == ERROR_IO_PENDING) {
    owner->issued = 1;
    HANDLE events[2] = { control->stopEvent, owner->operation.hEvent };
    DWORD observed = WaitForMultipleObjects(2, events, FALSE, INFINITE);
    DWORD waitError = observed == WAIT_FAILED ? GetLastError() : observed;
    int waitFailed = observed != WAIT_OBJECT_0 && observed != WAIT_OBJECT_0 + 1;
    READ_OBSERVE("read-event-wait",waitError,observed == WAIT_FAILED,waitFailed);
    if (observed != WAIT_OBJECT_0 + 1) {
      /* Cancellation names the exact issued operation, not a future read.
       * ERROR_NOT_FOUND means it raced completion; still await its result. */
      owner->cancelAttempted = 1;
      BOOL cancelled = CancelIoEx(control->pipe, &owner->operation);
      DWORD cancelError = cancelled ? 0 : GetLastError();
      READ_OBSERVE("read-exact-cancel",cancelError,1,!cancelled && cancelError != ERROR_NOT_FOUND);
      if (!cancelled && cancelError != ERROR_NOT_FOUND) result = -1;
    }
    BOOL complete = GetOverlappedResult(control->pipe, &owner->operation, &owner->read, TRUE);
    DWORD completionError = complete ? 0 : GetLastError();
    int stopped = observed == WAIT_OBJECT_0;
    int terminalExpected = !complete && ((stopped && completionError == ERROR_OPERATION_ABORTED) || completionError == ERROR_BROKEN_PIPE || completionError == ERROR_HANDLE_EOF || completionError == ERROR_NO_DATA);
    READ_OBSERVE("read-original-completion",completionError,1,!complete && !terminalExpected);
    /* A FALSE result is not automatically pending or automatically terminal.
     * The original OVERLAPPED must actually be complete; invalid-handle means
     * the API could not qualify the original operation at all. */
    if (!complete && (!HasOverlappedIoCompleted(&owner->operation) || completionError == ERROR_INVALID_HANDLE || completionError == ERROR_IO_INCOMPLETE)) RetainConpty();
    owner->completed = 1;
    if (waitFailed || (!complete && !terminalExpected)) result = -1;
    else if (result != -1) result = !stopped && complete && owner->read == 1;
  } else if (!eof) result = -1;
completed:
  owner->closeAttempted = 1;
  BOOL closed = CloseHandle(owner->operation.hEvent);
  DWORD closeError = closed ? 0 : GetLastError();
  READ_OBSERVE("read-close-event",closeError,1,!closed);
  if (!closed) RetainConpty();
  owner->closed = 1; owner->operation.hEvent = NULL;
  *read = owner->read; if (result == 1) *byte = owner->byte;
  return result;
}
#undef READ_OBSERVE

static int ReadControlLine(ConptyControl* control, char* line, DWORD capacity) {
  DWORD count = 0, read = 0;
  while (count + 1 < capacity) {
    int result = ReadControlByte(control, line + count, &read);
    if (result != 1) return result;
    if (line[count] == '\n') { line[count] = '\0'; return 1; }
    if ((unsigned char)line[count] < 32 || (unsigned char)line[count] > 126) return 0;
    count++;
  }
  return 0;
}

static int WriteControlLine(ConptyControl* control, const char* kind, DWORD pid, DWORD code) {
  char token[65], line[256]; DWORD written = 0;
  for (DWORD i = 0; i < 64; i++) token[i] = (char)control->token[i];
  token[64] = '\0';
  int length = _snprintf_s(line, sizeof(line), _TRUNCATE, "%s:%s:%lu:%lu:0\n", kind, token, (unsigned long)pid, (unsigned long)code);
  if (length <= 0) return 0;
  OVERLAPPED operation;
  ZeroMemory(&operation, sizeof(operation));
  operation.hEvent = CreateEventW(NULL, TRUE, FALSE, NULL);
  if (operation.hEvent == NULL) return 0;
  int result = WriteFile(control->pipe, line, (DWORD)length, &written, &operation);
  if (!result && GetLastError() == ERROR_IO_PENDING) result = GetOverlappedResult(control->pipe, &operation, &written, TRUE);
  CloseHandle(operation.hEvent);
  return result && written == (DWORD)length;
}

static int ReadControlCommand(ConptyControl* control, const char* kind) {
  char line[256], expected[256], token[65];
  for (DWORD i = 0; i < 64; i++) token[i] = (char)control->token[i];
  token[64] = '\0';
  if (_snprintf_s(expected, sizeof(expected), _TRUNCATE, "%s:%s", kind, token) < 0) return 0;
  return ReadControlLine(control, line, sizeof(line)) == 1 && strcmp(line, expected) == 0;
}

static DWORD WINAPI ConptyCancelReader(LPVOID parameter) {
  ConptyControl* control = (ConptyControl*)parameter;
  if (!ReadControlCommand(control, "cancel")) {
    if (InterlockedCompareExchange(&control->stopping, 0, 0)) return 0;
    InterlockedExchange(&control->failed, 1);
  } else {
    InterlockedExchange(&control->cancelled, 1);
  }
  /* A lost private channel is failure and containment, never launch success. */
  if (!TerminateJobObject(control->job, BOOTSTRAP_FAILURE_WAIT)) InterlockedExchange(&control->failed, 1);
  return 0;
}

static int OpenConptyControl(ConptyControl* control) {
  wchar_t pipeName[256], ownerText[32], *end = NULL;
  DWORD pipeLength = GetEnvironmentVariableW(L"SERVICE_LASSO_CONPTY_CONTROL_PIPE", pipeName, _countof(pipeName));
  DWORD tokenLength = GetEnvironmentVariableW(L"SERVICE_LASSO_CONPTY_CONTROL_TOKEN", control->token, _countof(control->token));
  DWORD ownerLength = GetEnvironmentVariableW(L"SERVICE_LASSO_CONPTY_CONTROL_OWNER", ownerText, _countof(ownerText));
  if (pipeLength == 0 && tokenLength == 0 && ownerLength == 0) return 0;
  /* Never expose control coordinates or token to managed/target descendants. */
  if (!SetEnvironmentVariableW(L"SERVICE_LASSO_CONPTY_CONTROL_PIPE", NULL) ||
      !SetEnvironmentVariableW(L"SERVICE_LASSO_CONPTY_CONTROL_TOKEN", NULL) ||
      !SetEnvironmentVariableW(L"SERVICE_LASSO_CONPTY_CONTROL_OWNER", NULL)) return -1;
  if (pipeLength == 0 || pipeLength >= _countof(pipeName) || tokenLength != 64 || ownerLength == 0 || ownerLength >= _countof(ownerText)) return -1;
  const wchar_t* prefix = L"\\\\.\\pipe\\service-lasso-conpty-";
  size_t prefixLength = wcslen(prefix);
  if (wcsncmp(pipeName, prefix, prefixLength) != 0 || wcslen(pipeName) != prefixLength + 64) return -1;
  for (DWORD i = 0; i < 64; i++) {
    wchar_t t = control->token[i], p = pipeName[prefixLength + i];
    if (!((t >= L'0' && t <= L'9') || (t >= L'a' && t <= L'f')) || !((p >= L'0' && p <= L'9') || (p >= L'a' && p <= L'f'))) return -1;
  }
  unsigned long ownerPid = wcstoul(ownerText, &end, 10);
  if (ownerPid == 0 || end == ownerText || *end != L'\0') return -1;
  control->stopEvent = CreateEventW(NULL, TRUE, FALSE, NULL);
  if (control->stopEvent == NULL) return -1;
  control->pipe = CreateFileW(pipeName, GENERIC_READ | GENERIC_WRITE, 0, NULL, OPEN_EXISTING, FILE_FLAG_OVERLAPPED, NULL);
  if (control->pipe == INVALID_HANDLE_VALUE) return -1;
  ULONG actualOwner = 0;
  if (!GetNamedPipeServerProcessId(control->pipe, &actualOwner) || actualOwner != ownerPid) return -1;
  control->owner = OpenProcess(SYNCHRONIZE | PROCESS_QUERY_LIMITED_INFORMATION, FALSE, actualOwner);
  if (control->owner == NULL || WaitForSingleObject(control->owner, 0) != WAIT_TIMEOUT) return -1;
  control->job = CreateJobObjectW(NULL, NULL);
  if (control->job == NULL) return -1;
  JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits;
  ZeroMemory(&limits, sizeof(limits));
  limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
  if (!SetInformationJobObject(control->job, JobObjectExtendedLimitInformation, &limits, sizeof(limits))) return -1;
  return 1;
}

#define CONTAIN_OBSERVE(site,status,native,failure) ObserveConpty(control,control->containment,&control->containmentCount,_countof(control->containment),site,status,native,failure)
static int DrainConptyJob(ConptyControl* control) {
  BOOL terminated = TerminateJobObject(control->job, BOOTSTRAP_FAILURE_WAIT);
  DWORD terminateError = terminated ? 0 : GetLastError();
  CONTAIN_OBSERVE("containment-job-terminate",terminateError,1,!terminated);
  if (!terminated) return 0;
  for (;;) {
    JOBOBJECT_BASIC_ACCOUNTING_INFORMATION accounting;
    BOOL queried = QueryInformationJobObject(control->job, JobObjectBasicAccountingInformation, &accounting, sizeof(accounting), NULL);
    DWORD queryError = queried ? 0 : GetLastError();
    if (!queried || accounting.ActiveProcesses == 0) {
      CONTAIN_OBSERVE("containment-job-accounting",queryError,1,!queried);
      return queried;
    }
    Sleep(1); /* observation only; never a new caller success deadline */
  }
}

static int FinishConptyContainment(ConptyControl* control, HANDLE process, HANDLE reader) {
  InterlockedExchange(&control->stopping, 1);
  BOOL stopped = SetEvent(control->stopEvent);
  DWORD stopError = stopped ? 0 : GetLastError();
  CONTAIN_OBSERVE("containment-stop",stopError,1,!stopped);
  control->containmentStop = stopped;
  /* Containment is never obstructed by joining a reader first. */
  int drained = DrainConptyJob(control);
  control->containmentDrain = drained;
  DWORD readerWait = reader == NULL ? WAIT_OBJECT_0 : WaitForSingleObject(reader, INFINITE);
  DWORD readerError = readerWait == WAIT_FAILED ? GetLastError() : readerWait;
  CONTAIN_OBSERVE("containment-reader-wait",readerError,readerWait == WAIT_FAILED,readerWait != WAIT_OBJECT_0);
  int readerClosed = readerWait == WAIT_OBJECT_0;
  control->containmentReader = readerClosed;
  DWORD processWait = WaitForSingleObject(process, INFINITE);
  DWORD processError = processWait == WAIT_FAILED ? GetLastError() : processWait;
  CONTAIN_OBSERVE("containment-process-wait",processError,processWait == WAIT_FAILED,processWait != WAIT_OBJECT_0);
  int managedClosed = processWait == WAIT_OBJECT_0;
  control->containmentProcess = managedClosed;
  if (!stopped || !drained || !readerClosed || !managedClosed) RetainConpty();
  return drained && readerClosed && managedClosed;
}
#undef CONTAIN_OBSERVE

static int IsLoaderSensitiveName(const wchar_t* name) {
  return _wcsnicmp(name, L"COR_", 4) == 0 ||
    _wcsnicmp(name, L"CORECLR_", 8) == 0 ||
    _wcsnicmp(name, L"COMPLUS_", 8) == 0 ||
    _wcsnicmp(name, L"APPDOMAIN_MANAGER", 17) == 0;
}

static int SanitizeLoaderEnvironment(void) {
  LPWCH environment = GetEnvironmentStringsW();
  if (environment == NULL) return 0;
  for (LPWCH item = environment; *item != L'\0'; item += wcslen(item) + 1) {
    const wchar_t* equals = wcschr(item, L'=');
    if (equals == NULL || equals == item) continue;
    size_t nameLength = (size_t)(equals - item);
    if (nameLength >= 256) { FreeEnvironmentStringsW(environment); return 0; }
    wchar_t name[256];
    memcpy(name, item, nameLength * sizeof(wchar_t));
    name[nameLength] = L'\0';
    if (IsLoaderSensitiveName(name) && !SetEnvironmentVariableW(name, NULL)) {
      FreeEnvironmentStringsW(environment);
      return 0;
    }
  }
  FreeEnvironmentStringsW(environment);
  return 1;
}

static int GetSelfDirectory(wchar_t* directory, DWORD capacity) {
  DWORD length = GetModuleFileNameW(NULL, directory, capacity);
  if (length == 0 || length >= capacity) return 0;
  wchar_t* slash = wcsrchr(directory, L'\\');
  if (slash == NULL) return 0;
  *slash = L'\0';
  return 1;
}

static int SameFinalPath(const wchar_t* expected, const wchar_t* actual) {
  wchar_t longExpected[32768];
  DWORD longExpectedLength = GetLongPathNameW(expected, longExpected, (DWORD)_countof(longExpected));
  const wchar_t* normalizedExpected = longExpectedLength != 0 && longExpectedLength < _countof(longExpected) ? longExpected : expected;
  if (wcsncmp(normalizedExpected, L"\\\\?\\", 4) == 0) normalizedExpected += 4;
  const wchar_t* normalized = actual;
  if (wcsncmp(normalized, L"\\\\?\\", 4) == 0) normalized += 4;
  return _wcsicmp(normalizedExpected, normalized) == 0;
}

/*
 * CreateProcessW still resolves a pathname after the managed image has been
 * attested.  Holding only that leaf therefore leaves each mutable ancestor
 * available for a rename-and-replace race.  Bind every component from the
 * mutable components beneath the volume root through the package directory
 * with FILE_SHARE_DELETE withheld.
 * Each handle is also checked against its final path, which rejects a reparse
 * component instead of silently following it.
 */
static void ReleasePackageDirectories(HANDLE* handles, DWORD count) {
  while (count > 0) CloseHandle(handles[--count]);
}

static int VerifyPackageDirectory(const wchar_t* requestedDirectory, wchar_t* finalDirectory, DWORD capacity, HANDLE* handles, DWORD* handleCount) {
  wchar_t canonical[32768];
  wchar_t packageFinalPath[32768];
  DWORD length = GetFullPathNameW(requestedDirectory, (DWORD)_countof(canonical), canonical, NULL);
  if (length == 0 || length >= _countof(canonical) || length < 3 || canonical[1] != L':' || canonical[2] != L'\\') return 0;
  DWORD count = 0;
  for (wchar_t* componentEnd = canonical + 3;; ++componentEnd) {
    if (*componentEnd != L'\\' && *componentEnd != L'\0') continue;
    wchar_t preserved = *componentEnd;
    *componentEnd = L'\0';
    DWORD attributes = GetFileAttributesW(canonical);
    HANDLE directory = INVALID_HANDLE_VALUE;
    wchar_t componentFinalPath[32768];
    DWORD finalLength = 0;
    int finalPathMatches = 0;
    if (attributes != INVALID_FILE_ATTRIBUTES && (attributes & (FILE_ATTRIBUTE_REPARSE_POINT | FILE_ATTRIBUTE_DIRECTORY)) == FILE_ATTRIBUTE_DIRECTORY && count < PACKAGE_DIRECTORY_HANDLE_CAPACITY) {
      directory = CreateFileW(canonical, GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_WRITE, NULL, OPEN_EXISTING, FILE_FLAG_BACKUP_SEMANTICS, NULL);
      if (directory != INVALID_HANDLE_VALUE) {
        finalLength = GetFinalPathNameByHandleW(directory, componentFinalPath, (DWORD)_countof(componentFinalPath), 0);
        finalPathMatches = finalLength != 0 && finalLength < _countof(componentFinalPath) && SameFinalPath(canonical, componentFinalPath);
      }
    }
    *componentEnd = preserved;
    if (directory == INVALID_HANDLE_VALUE || !finalPathMatches) {
      if (directory != INVALID_HANDLE_VALUE) CloseHandle(directory);
      ReleasePackageDirectories(handles, count);
      return 0;
    }
    handles[count++] = directory;
    if (preserved == L'\0') {
      const wchar_t* normalizedPackageFinalPath = componentFinalPath;
      if (wcsncmp(normalizedPackageFinalPath, L"\\\\?\\", 4) == 0) normalizedPackageFinalPath += 4;
      if (wcsncpy_s(packageFinalPath, _countof(packageFinalPath), normalizedPackageFinalPath, _TRUNCATE) != 0) {
        ReleasePackageDirectories(handles, count);
        return 0;
      }
      break;
    }
  }
  if (!SameFinalPath(requestedDirectory, packageFinalPath) || wcsncpy_s(finalDirectory, capacity, packageFinalPath, _TRUNCATE) != 0) {
    ReleasePackageDirectories(handles, count);
    return 0;
  }
  *handleCount = count;
  return 1;
}

static int VerifyManagedLauncher(const wchar_t* managedPath, HANDLE* heldHandle) {
  DWORD attributes = GetFileAttributesW(managedPath);
  if (attributes == INVALID_FILE_ATTRIBUTES || (attributes & FILE_ATTRIBUTE_REPARSE_POINT) != 0 || (attributes & FILE_ATTRIBUTE_DIRECTORY) != 0) return 0;
  HANDLE file = CreateFileW(managedPath, GENERIC_READ, FILE_SHARE_READ, NULL, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, NULL);
  if (file == INVALID_HANDLE_VALUE) return 0;
  LARGE_INTEGER size;
  wchar_t finalPath[32768];
  BCRYPT_ALG_HANDLE algorithm = NULL;
  BCRYPT_HASH_HANDLE hash = NULL;
  PUCHAR hashObject = NULL;
  DWORD hashObjectLength = 0, resultLength = 0;
  unsigned char digest[32];
  unsigned char buffer[8192];
  DWORD bytesRead = 0;
  int valid = 0;
  if (!GetFileSizeEx(file, &size) || size.QuadPart != MANAGED_LAUNCHER_BYTE_LENGTH) goto cleanup;
  DWORD finalLength = GetFinalPathNameByHandleW(file, finalPath, (DWORD)(sizeof(finalPath) / sizeof(finalPath[0])), 0);
  if (finalLength == 0 || finalLength >= (DWORD)(sizeof(finalPath) / sizeof(finalPath[0])) || !SameFinalPath(managedPath, finalPath)) goto cleanup;
  if (BCryptOpenAlgorithmProvider(&algorithm, BCRYPT_SHA256_ALGORITHM, NULL, 0) != 0) goto cleanup;
  if (BCryptGetProperty(algorithm, BCRYPT_OBJECT_LENGTH, (PUCHAR)&hashObjectLength, sizeof(hashObjectLength), &resultLength, 0) != 0 || hashObjectLength == 0) goto cleanup;
  hashObject = (PUCHAR)HeapAlloc(GetProcessHeap(), HEAP_ZERO_MEMORY, hashObjectLength);
  if (hashObject == NULL || BCryptCreateHash(algorithm, &hash, hashObject, hashObjectLength, NULL, 0, 0) != 0) goto cleanup;
  for (;;) {
    if (!ReadFile(file, buffer, sizeof(buffer), &bytesRead, NULL)) goto cleanup;
    if (bytesRead == 0) break;
    if (BCryptHashData(hash, buffer, bytesRead, 0) != 0) goto cleanup;
  }
  if (BCryptFinishHash(hash, digest, sizeof(digest), 0) != 0 || memcmp(digest, MANAGED_LAUNCHER_SHA256, sizeof(digest)) != 0) goto cleanup;
  valid = 1;
cleanup:
  SecureZeroMemory(buffer, sizeof(buffer));
  SecureZeroMemory(digest, sizeof(digest));
  if (hash != NULL) BCryptDestroyHash(hash);
  if (algorithm != NULL) BCryptCloseAlgorithmProvider(algorithm, 0);
  if (hashObject != NULL) { SecureZeroMemory(hashObject, hashObjectLength); HeapFree(GetProcessHeap(), 0, hashObject); }
  if (!valid) { CloseHandle(file); return 0; }
  *heldHandle = file;
  return 1;
}

int wmain(void) {
  wchar_t directory[32768];
  wchar_t finalDirectory[32768];
  wchar_t managedPath[32768];
  wchar_t commandLine[32770];
  HANDLE heldHandle = INVALID_HANDLE_VALUE;
  HANDLE heldDirectories[PACKAGE_DIRECTORY_HANDLE_CAPACITY];
  DWORD heldDirectoryCount = 0;
  STARTUPINFOW startupInfo;
  PROCESS_INFORMATION processInformation;
  DWORD exitCode = BOOTSTRAP_FAILURE_UNKNOWN;
  ConptyControl control;
  HANDLE controlThread = NULL;
  int conptyMode;
  ZeroMemory(&control, sizeof(control));
  control.pipe = INVALID_HANDLE_VALUE;
  if (!SanitizeLoaderEnvironment()) return BOOTSTRAP_FAILURE_UNKNOWN;
  if (!GetSelfDirectory(directory, (DWORD)(sizeof(directory) / sizeof(directory[0])))) return BOOTSTRAP_FAILURE_BINDING;
  if (!VerifyPackageDirectory(directory, finalDirectory, (DWORD)_countof(finalDirectory), heldDirectories, &heldDirectoryCount)) return BOOTSTRAP_FAILURE_BINDING;
  if (_snwprintf_s(managedPath, _countof(managedPath), _TRUNCATE, L"%s\\%s", finalDirectory, MANAGED_LAUNCHER_NAME) < 0) { ReleasePackageDirectories(heldDirectories, heldDirectoryCount); return BOOTSTRAP_FAILURE_BINDING; }
  if (!VerifyManagedLauncher(managedPath, &heldHandle)) { ReleasePackageDirectories(heldDirectories, heldDirectoryCount); return BOOTSTRAP_FAILURE_BINDING; }
  conptyMode = OpenConptyControl(&control);
  if (conptyMode < 0) { exitCode = BOOTSTRAP_FAILURE_BINDING; goto release; }
  if (_snwprintf_s(commandLine, _countof(commandLine), _TRUNCATE, L"\"%s\"", managedPath) < 0) { CloseHandle(heldHandle); ReleasePackageDirectories(heldDirectories, heldDirectoryCount); return BOOTSTRAP_FAILURE_CREATE; }
  ZeroMemory(&startupInfo, sizeof(startupInfo));
  ZeroMemory(&processInformation, sizeof(processInformation));
  startupInfo.cb = sizeof(startupInfo);
  if (!CreateProcessW(managedPath, commandLine, NULL, NULL, FALSE, conptyMode ? CREATE_SUSPENDED : 0, NULL, NULL, &startupInfo, &processInformation)) { exitCode = BOOTSTRAP_FAILURE_CREATE; goto release; }
  if (conptyMode) {
    if (!AssignProcessToJobObject(control.job, processInformation.hProcess)) {
      TerminateProcess(processInformation.hProcess, BOOTSTRAP_FAILURE_CREATE);
      WaitForSingleObject(processInformation.hProcess, INFINITE);
      exitCode = BOOTSTRAP_FAILURE_CREATE; goto contained;
    }
    if (!WriteControlLine(&control, "registered", GetCurrentProcessId(), 0) || !ReadControlCommand(&control, "resume")) { exitCode = BOOTSTRAP_FAILURE_CREATE; goto contained; }
    controlThread = CreateThread(NULL, 0, ConptyCancelReader, &control, 0, NULL);
    if (controlThread == NULL || ResumeThread(processInformation.hThread) == (DWORD)-1) { exitCode = BOOTSTRAP_FAILURE_CREATE; goto contained; }
  }
  CloseHandle(processInformation.hThread);
  processInformation.hThread = NULL;
  if (WaitForSingleObject(processInformation.hProcess, INFINITE) != WAIT_OBJECT_0 || !GetExitCodeProcess(processInformation.hProcess, &exitCode)) exitCode = BOOTSTRAP_FAILURE_WAIT;
contained:
  if (conptyMode) {
    if (!FinishConptyContainment(&control, processInformation.hProcess, controlThread)) {
      /* No receipt: JavaScript retains inputs and does not enter caller cleanup. */
      exitCode = BOOTSTRAP_FAILURE_WAIT;
    } else {
      if (control.cancelled || control.failed) exitCode = BOOTSTRAP_FAILURE_WAIT;
      if (!WriteControlLine(&control, "terminal", GetCurrentProcessId(), exitCode)) exitCode = BOOTSTRAP_FAILURE_WAIT;
    }
    if (controlThread != NULL) { CloseHandle(controlThread); controlThread = NULL; }
  }
  if (processInformation.hThread != NULL) CloseHandle(processInformation.hThread);
  CloseHandle(processInformation.hProcess);
release:
  if (control.stopEvent != NULL) CloseHandle(control.stopEvent);
  if (control.job != NULL) CloseHandle(control.job);
  if (control.owner != NULL) CloseHandle(control.owner);
  if (control.pipe != INVALID_HANDLE_VALUE) CloseHandle(control.pipe);
  CloseHandle(heldHandle);
  ReleasePackageDirectories(heldDirectories, heldDirectoryCount);
  return (int)exitCode;
}
