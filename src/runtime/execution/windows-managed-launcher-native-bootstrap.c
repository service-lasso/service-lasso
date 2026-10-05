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
typedef struct ConptyWriteOwner {
  struct ConptyWriteOwner* next;
  OVERLAPPED operation;
  char token[65], line[256];
  DWORD written;
  int length, issued, completed, cancelAttempted, closeAttempted, closed, result;
  unsigned observations;
  ConptyObservation ledger[10];
} ConptyWriteOwner;
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
  ConptyWriteOwner* writes;
  void (*observeFailure)(void*, const char*, DWORD, int);
  void* observationOwner;
  ConptyObservation containment[8];
  unsigned containmentCount;
  int containmentStop, containmentDrain, containmentReader, containmentProcess;
  /* 0 unissued, 1 one original call in progress, 2 original outcome published.
   * This dedicated ledger has one writer; finisher reads only after publication. */
  volatile LONG terminationDisposition;
  HANDLE terminationOriginal;
  DWORD terminationOrdinal;
  int terminationSucceeded;
  ConptyObservation termination[1];
  unsigned terminationCount;
  struct { HANDLE original; const char* site; DWORD ordinal, status; int attempted, closed; }
    releases[PACKAGE_DIRECTORY_HANDLE_CAPACITY + 16];
  unsigned releaseCount;
  int releaseFailed;
  /* Enclosing bootstrap ownership exists with or without ConPTY opt-in.
   * Return value and error are separate: NTSTATUS never uses GetLastError. */
  struct { const char* site; ULONG_PTR original; DWORD ordinal, result, status;
    int kind, failure; } bootstrap[256];
  unsigned bootstrapCount;
  BCRYPT_ALG_HANDLE hashProvider;
  BCRYPT_HASH_HANDLE hashHandle;
  PUCHAR hashStorage;
  DWORD hashStorageLength;
  LPWCH environmentBlock;
  int allocationReleaseFailed, originalChildClosed, originalChildAssigned;
  DWORD originalExitCode;
  PROCESS_INFORMATION originalChild;
  HANDLE originalHeldFile, originalHeldDirectories[PACKAGE_DIRECTORY_HANDLE_CAPACITY];
  DWORD originalHeldDirectoryCount;
} ConptyControl;

enum { BOOTSTRAP_RESULT_WIN32 = 1, BOOTSTRAP_RESULT_NTSTATUS = 2,
  BOOTSTRAP_RESULT_VALUE = 3, BOOTSTRAP_RESULT_HEAP = 4 };
static void ObserveBootstrap(ConptyControl* control, const char* site, ULONG_PTR original,
    DWORD result, DWORD status, int kind, int failure) {
  if (control->bootstrapCount >= _countof(control->bootstrap)) { for (;;) Sleep(INFINITE); }
  unsigned index = control->bootstrapCount++;
  control->bootstrap[index].site = site; control->bootstrap[index].original = original;
  control->bootstrap[index].ordinal = index; control->bootstrap[index].result = result;
  control->bootstrap[index].status = status; control->bootstrap[index].kind = kind;
  control->bootstrap[index].failure = failure;
  if (failure) InterlockedExchange(&control->failed,1);
}

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

#define WRITE_OBSERVE(site,status,native,failure) ObserveConpty(control,owner->ledger,&owner->observations,_countof(owner->ledger),site,status,native,failure)
static int CompleteControlWrite(ConptyControl* control, ConptyWriteOwner* owner) {
  BOOL complete = GetOverlappedResult(control->pipe,&owner->operation,&owner->written,TRUE);
  DWORD completionError = complete ? 0 : GetLastError();
  WRITE_OBSERVE("write-original-completion",completionError,1,!complete);
  if (!complete && (!HasOverlappedIoCompleted(&owner->operation) || completionError == ERROR_INVALID_HANDLE || completionError == ERROR_IO_INCOMPLETE)) RetainConpty();
  owner->completed = 1; return complete;
}
static void CloseControlWrite(ConptyControl* control, ConptyWriteOwner* owner) {
  owner->closeAttempted = 1;
  BOOL closed = CloseHandle(owner->operation.hEvent);
  DWORD closeError = closed ? 0 : GetLastError();
  WRITE_OBSERVE("write-close-event",closeError,1,!closed);
  if (!closed) RetainConpty();
  owner->closed = 1; owner->operation.hEvent = NULL;
}
static int WriteControlLine(ConptyControl* control, const char* kind, DWORD pid, DWORD code) {
  ConptyWriteOwner* owner = (ConptyWriteOwner*)HeapAlloc(GetProcessHeap(),HEAP_ZERO_MEMORY,sizeof(*owner));
  if (!owner) {
    InterlockedExchange(&control->failed,1);
    if (control->observeFailure) control->observeFailure(control->observationOwner,"write-owner-allocation",ERROR_NOT_ENOUGH_MEMORY,0);
    return 0;
  }
  owner->next = control->writes; control->writes = owner;
  for (DWORD i = 0; i < 64; i++) owner->token[i] = (char)control->token[i];
  owner->token[64] = '\0';
  owner->length = _snprintf_s(owner->line,sizeof(owner->line),_TRUNCATE,"%s:%s:%lu:%lu:0\n",kind,owner->token,(unsigned long)pid,(unsigned long)code);
  WRITE_OBSERVE("write-format",0,0,owner->length <= 0);
  if (owner->length <= 0) return 0;
  owner->operation.hEvent = CreateEventW(NULL,TRUE,FALSE,NULL);
  DWORD eventError = owner->operation.hEvent ? 0 : GetLastError();
  WRITE_OBSERVE("write-create-event",eventError,1,!owner->operation.hEvent);
  if (!owner->operation.hEvent) return 0;
  BOOL issued = WriteFile(control->pipe,owner->line,(DWORD)owner->length,&owner->written,&owner->operation);
  DWORD issueError = issued ? 0 : GetLastError();
  WRITE_OBSERVE("write-issuance",issueError,1,!issued && issueError != ERROR_IO_PENDING);
  if (issued) { owner->issued = 1; owner->completed = 1; owner->result = 1; }
  else if (issueError == ERROR_IO_PENDING) {
    owner->issued = 1;
    DWORD observed = WaitForSingleObject(owner->operation.hEvent,INFINITE);
    DWORD waitError = observed == WAIT_FAILED ? GetLastError() : observed;
    WRITE_OBSERVE("write-event-wait",waitError,observed == WAIT_FAILED,observed != WAIT_OBJECT_0);
    if (observed != WAIT_OBJECT_0) {
      owner->cancelAttempted = 1;
      BOOL cancelled = CancelIoEx(control->pipe,&owner->operation);
      DWORD cancelError = cancelled ? 0 : GetLastError();
      WRITE_OBSERVE("write-exact-cancel",cancelError,1,!cancelled && cancelError != ERROR_NOT_FOUND);
    }
    int complete = CompleteControlWrite(control,owner);
    owner->result = complete && observed == WAIT_OBJECT_0;
  }
  /* Close only after qualified original completion or synchronous non-issuance.
   * Unknown completion/release retains this linked original owner and invocation. */
  CloseControlWrite(control,owner);
  WRITE_OBSERVE("write-exact-count",0,0,owner->result && owner->written != (DWORD)owner->length);
  return owner->result && owner->written == (DWORD)owner->length;
}
#undef WRITE_OBSERVE

static int ReadControlCommand(ConptyControl* control, const char* kind) {
  char line[256], expected[256], token[65];
  for (DWORD i = 0; i < 64; i++) token[i] = (char)control->token[i];
  token[64] = '\0';
  if (_snprintf_s(expected, sizeof(expected), _TRUNCATE, "%s:%s", kind, token) < 0) return 0;
  return ReadControlLine(control, line, sizeof(line)) == 1 && strcmp(line, expected) == 0;
}

static int TerminateOriginalConptyJob(ConptyControl* control, const char* site) {
  if (InterlockedCompareExchange(&control->terminationDisposition,1,0) == 0) {
    control->terminationOriginal = control->job;
    control->terminationOrdinal = 1;
    BOOL terminated = TerminateJobObject(control->terminationOriginal,BOOTSTRAP_FAILURE_WAIT);
    DWORD error = terminated ? 0 : GetLastError();
    control->terminationSucceeded = terminated;
    ObserveConpty(control,control->termination,&control->terminationCount,
      _countof(control->termination),site,error,1,!terminated);
    InterlockedExchange(&control->terminationDisposition,2);
  } else {
    while (InterlockedCompareExchange(&control->terminationDisposition,0,0) != 2) Sleep(0);
  }
  return control->terminationSucceeded;
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
  TerminateOriginalConptyJob(control,"cancel-reader-job-terminate");
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
  int terminated = TerminateOriginalConptyJob(control,"containment-job-terminate");
  for (;;) {
    JOBOBJECT_BASIC_ACCOUNTING_INFORMATION accounting;
    BOOL queried = QueryInformationJobObject(control->job, JobObjectBasicAccountingInformation, &accounting, sizeof(accounting), NULL);
    DWORD queryError = queried ? 0 : GetLastError();
    if (!queried || accounting.ActiveProcesses == 0) {
      CONTAIN_OBSERVE("containment-job-accounting",queryError,1,!queried);
      return queried && terminated;
    }
    Sleep(1); /* observation only; never a new caller success deadline */
  }
}

static int FinishConptyContainmentObserved(ConptyControl* control, HANDLE process, HANDLE reader, int alreadyClosed) {
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
  /* Actual entrypoint supplies its original qualified wait. A helper caller
   * without a prior observation still owns exactly this first process wait. */
  DWORD processWait = alreadyClosed ? WAIT_OBJECT_0 : WaitForSingleObject(process, INFINITE);
  DWORD processError = processWait == WAIT_FAILED ? GetLastError() : processWait;
  if (!alreadyClosed) CONTAIN_OBSERVE("containment-process-wait",processError,processWait == WAIT_FAILED,processWait != WAIT_OBJECT_0);
  int managedClosed = processWait == WAIT_OBJECT_0;
  control->containmentProcess = managedClosed;
  if (!stopped || !drained || !readerClosed || !managedClosed) RetainConpty();
  return drained && readerClosed && managedClosed;
}
static int FinishConptyContainment(ConptyControl* control, HANDLE process, HANDLE reader) {
  return FinishConptyContainmentObserved(control,process,reader,0);
}
#undef CONTAIN_OBSERVE

static int IsLoaderSensitiveName(const wchar_t* name) {
  return _wcsnicmp(name, L"COR_", 4) == 0 ||
    _wcsnicmp(name, L"CORECLR_", 8) == 0 ||
    _wcsnicmp(name, L"COMPLUS_", 8) == 0 ||
    _wcsnicmp(name, L"APPDOMAIN_MANAGER", 17) == 0;
}

static int SanitizeLoaderEnvironmentOwned(ConptyControl* control) {
  LPWCH environment = GetEnvironmentStringsW();
  DWORD acquireError = environment ? 0 : GetLastError();
  control->environmentBlock = environment;
  ObserveBootstrap(control,"loader-environment-acquire",(ULONG_PTR)environment,
    environment != NULL,acquireError,BOOTSTRAP_RESULT_WIN32,environment == NULL);
  if (environment == NULL) return 0;
  int sanitized = 1;
  for (LPWCH item = environment; *item != L'\0'; item += wcslen(item) + 1) {
    const wchar_t* equals = wcschr(item, L'=');
    if (equals == NULL || equals == item) continue;
    size_t nameLength = (size_t)(equals - item);
    if (nameLength >= 256) {
      ObserveBootstrap(control,"loader-environment-name-length",(ULONG_PTR)item,
        (DWORD)nameLength,0,BOOTSTRAP_RESULT_VALUE,1);
      sanitized = 0; break;
    }
    wchar_t name[256];
    memcpy(name, item, nameLength * sizeof(wchar_t));
    name[nameLength] = L'\0';
    if (IsLoaderSensitiveName(name)) {
      BOOL removed = SetEnvironmentVariableW(name,NULL);
      DWORD removeError = removed ? 0 : GetLastError();
      ObserveBootstrap(control,"loader-environment-remove",(ULONG_PTR)item,removed,
        removeError,BOOTSTRAP_RESULT_WIN32,!removed);
      if (!removed) { sanitized = 0; break; }
    }
  }
  BOOL freed = FreeEnvironmentStringsW(environment);
  DWORD freeError = freed ? 0 : GetLastError();
  ObserveBootstrap(control,"loader-environment-release",(ULONG_PTR)environment,
    freed,freeError,BOOTSTRAP_RESULT_WIN32,!freed);
  if (!freed) { control->allocationReleaseFailed = 1; RetainConpty(); }
  control->environmentBlock = NULL;
  return sanitized;
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
static void ReleaseBootstrapHandle(ConptyControl* control, HANDLE* handle, const char* site, DWORD ordinal) {
  if (*handle == NULL || *handle == INVALID_HANDLE_VALUE) return;
  if (control->releaseCount >= _countof(control->releases)) RetainConpty();
  unsigned index = control->releaseCount++;
  control->releases[index].original = *handle;
  control->releases[index].site = site;
  control->releases[index].ordinal = ordinal;
  control->releases[index].attempted = 1;
  BOOL closed = CloseHandle(*handle);
  DWORD error = closed ? 0 : GetLastError();
  control->releases[index].status = error;
  control->releases[index].closed = closed;
  if (!closed) {
    control->releaseFailed = 1;
    InterlockedExchange(&control->failed,1);
    if (control->observeFailure) control->observeFailure(control->observationOwner,site,error,1);
  } else *handle = NULL;
}
static void ReleasePackageDirectories(ConptyControl* control, HANDLE* handles, DWORD count) {
  while (count > 0) { --count; ReleaseBootstrapHandle(control,&handles[count],"release-package-directory",count); }
  if (control->releaseFailed) RetainConpty();
}

static int VerifyPackageDirectory(ConptyControl* control, const wchar_t* requestedDirectory, wchar_t* finalDirectory, DWORD capacity, HANDLE* handles, DWORD* handleCount) {
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
      ReleaseBootstrapHandle(control,&directory,"release-unverified-directory",count);
      ReleasePackageDirectories(control,handles, count);
      return 0;
    }
    handles[count++] = directory;
    if (preserved == L'\0') {
      const wchar_t* normalizedPackageFinalPath = componentFinalPath;
      if (wcsncmp(normalizedPackageFinalPath, L"\\\\?\\", 4) == 0) normalizedPackageFinalPath += 4;
      if (wcsncpy_s(packageFinalPath, _countof(packageFinalPath), normalizedPackageFinalPath, _TRUNCATE) != 0) {
        ReleasePackageDirectories(control,handles, count);
        return 0;
      }
      break;
    }
  }
  if (!SameFinalPath(requestedDirectory, packageFinalPath) || wcsncpy_s(finalDirectory, capacity, packageFinalPath, _TRUNCATE) != 0) {
    ReleasePackageDirectories(control,handles, count);
    return 0;
  }
  *handleCount = count;
  return 1;
}

static int VerifyManagedLauncher(ConptyControl* control, const wchar_t* managedPath, HANDLE* heldHandle) {
  DWORD attributes = GetFileAttributesW(managedPath);
  DWORD attributesError = attributes == INVALID_FILE_ATTRIBUTES ? GetLastError() : 0;
  ObserveBootstrap(control,"managed-file-attributes",0,attributes,attributesError,BOOTSTRAP_RESULT_WIN32,
    attributes == INVALID_FILE_ATTRIBUTES || (attributes & (FILE_ATTRIBUTE_REPARSE_POINT | FILE_ATTRIBUTE_DIRECTORY)) != 0);
  if (attributes == INVALID_FILE_ATTRIBUTES || (attributes & FILE_ATTRIBUTE_REPARSE_POINT) != 0 || (attributes & FILE_ATTRIBUTE_DIRECTORY) != 0) return 0;
  HANDLE file = CreateFileW(managedPath, GENERIC_READ, FILE_SHARE_READ, NULL, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, NULL);
  DWORD fileError = file == INVALID_HANDLE_VALUE ? GetLastError() : 0;
  ObserveBootstrap(control,"managed-file-acquire",(ULONG_PTR)file,file != INVALID_HANDLE_VALUE,fileError,BOOTSTRAP_RESULT_WIN32,file == INVALID_HANDLE_VALUE);
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
  BOOL sized = GetFileSizeEx(file, &size);
  DWORD sizeError = sized ? 0 : GetLastError();
  ObserveBootstrap(control,"managed-size",(ULONG_PTR)file,sized,sizeError,BOOTSTRAP_RESULT_WIN32,!sized);
  if (sized) ObserveBootstrap(control,"managed-size-binding",(ULONG_PTR)file,
    size.QuadPart == MANAGED_LAUNCHER_BYTE_LENGTH,0,BOOTSTRAP_RESULT_VALUE,size.QuadPart != MANAGED_LAUNCHER_BYTE_LENGTH);
  if (!sized || size.QuadPart != MANAGED_LAUNCHER_BYTE_LENGTH) goto cleanup;
  DWORD finalLength = GetFinalPathNameByHandleW(file, finalPath, (DWORD)(sizeof(finalPath) / sizeof(finalPath[0])), 0);
  DWORD finalError = finalLength == 0 ? GetLastError() : 0;
  ObserveBootstrap(control,"managed-file-final-path",(ULONG_PTR)file,finalLength,finalError,BOOTSTRAP_RESULT_WIN32,finalLength == 0 || finalLength >= _countof(finalPath));
  if (finalLength == 0 || finalLength >= (DWORD)(sizeof(finalPath) / sizeof(finalPath[0]))) goto cleanup;
  int pathMatches = SameFinalPath(managedPath, finalPath);
  ObserveBootstrap(control,"managed-file-path-binding",(ULONG_PTR)file,pathMatches,0,BOOTSTRAP_RESULT_VALUE,!pathMatches);
  if (!pathMatches) goto cleanup;
  NTSTATUS cryptoStatus = BCryptOpenAlgorithmProvider(&algorithm, BCRYPT_SHA256_ALGORITHM, NULL, 0);
  control->hashProvider = algorithm;
  ObserveBootstrap(control,"hash-provider-acquire",(ULONG_PTR)algorithm,(DWORD)cryptoStatus,(DWORD)cryptoStatus,BOOTSTRAP_RESULT_NTSTATUS,cryptoStatus != 0);
  if (cryptoStatus != 0) goto cleanup;
  cryptoStatus = BCryptGetProperty(algorithm, BCRYPT_OBJECT_LENGTH, (PUCHAR)&hashObjectLength, sizeof(hashObjectLength), &resultLength, 0);
  ObserveBootstrap(control,"hash-object-length",(ULONG_PTR)algorithm,(DWORD)cryptoStatus,(DWORD)cryptoStatus,BOOTSTRAP_RESULT_NTSTATUS,cryptoStatus != 0 || hashObjectLength == 0);
  if (cryptoStatus != 0 || hashObjectLength == 0) goto cleanup;
  hashObject = (PUCHAR)HeapAlloc(GetProcessHeap(), HEAP_ZERO_MEMORY, hashObjectLength);
  control->hashStorage = hashObject; control->hashStorageLength = hashObjectLength;
  ObserveBootstrap(control,"hash-storage-acquire",(ULONG_PTR)hashObject,hashObject != NULL,0,BOOTSTRAP_RESULT_HEAP,hashObject == NULL);
  if (hashObject == NULL) goto cleanup;
  cryptoStatus = BCryptCreateHash(algorithm, &hash, hashObject, hashObjectLength, NULL, 0, 0);
  control->hashHandle = hash;
  ObserveBootstrap(control,"hash-acquire",(ULONG_PTR)hash,(DWORD)cryptoStatus,(DWORD)cryptoStatus,BOOTSTRAP_RESULT_NTSTATUS,cryptoStatus != 0);
  if (cryptoStatus != 0) goto cleanup;
  for (;;) {
    BOOL read = ReadFile(file, buffer, sizeof(buffer), &bytesRead, NULL);
    DWORD readError = read ? 0 : GetLastError();
    ObserveBootstrap(control,"managed-hash-read",(ULONG_PTR)file,read,readError,BOOTSTRAP_RESULT_WIN32,!read);
    if (!read) goto cleanup;
    if (bytesRead == 0) break;
    cryptoStatus = BCryptHashData(hash, buffer, bytesRead, 0);
    ObserveBootstrap(control,"hash-data",(ULONG_PTR)hash,(DWORD)cryptoStatus,(DWORD)cryptoStatus,BOOTSTRAP_RESULT_NTSTATUS,cryptoStatus != 0);
    if (cryptoStatus != 0) goto cleanup;
  }
  cryptoStatus = BCryptFinishHash(hash, digest, sizeof(digest), 0);
  ObserveBootstrap(control,"hash-finish",(ULONG_PTR)hash,(DWORD)cryptoStatus,(DWORD)cryptoStatus,BOOTSTRAP_RESULT_NTSTATUS,cryptoStatus != 0);
  if (cryptoStatus != 0) goto cleanup;
  int digestMatches = memcmp(digest, MANAGED_LAUNCHER_SHA256, sizeof(digest)) == 0;
  ObserveBootstrap(control,"managed-digest-binding",(ULONG_PTR)file,digestMatches,0,BOOTSTRAP_RESULT_VALUE,!digestMatches);
  if (!digestMatches) goto cleanup;
  valid = 1;
cleanup:
  SecureZeroMemory(buffer, sizeof(buffer));
  SecureZeroMemory(digest, sizeof(digest));
  if (hash != NULL) {
    cryptoStatus = BCryptDestroyHash(hash);
    ObserveBootstrap(control,"hash-destroy",(ULONG_PTR)hash,(DWORD)cryptoStatus,(DWORD)cryptoStatus,BOOTSTRAP_RESULT_NTSTATUS,cryptoStatus != 0);
    if (cryptoStatus == 0) { hash = NULL; control->hashHandle = NULL; }
    else control->allocationReleaseFailed = 1;
  }
  /* Hash owns its backing memory and provider dependency until actual original
   * destruction. Never erase/free storage or retire that provider on failure. */
  if (hash == NULL && algorithm != NULL) {
    cryptoStatus = BCryptCloseAlgorithmProvider(algorithm, 0);
    ObserveBootstrap(control,"hash-provider-release",(ULONG_PTR)algorithm,(DWORD)cryptoStatus,(DWORD)cryptoStatus,BOOTSTRAP_RESULT_NTSTATUS,cryptoStatus != 0);
    if (cryptoStatus == 0) control->hashProvider = NULL;
    else control->allocationReleaseFailed = 1;
  }
  if (hash == NULL && hashObject != NULL) {
    SecureZeroMemory(hashObject, hashObjectLength);
    BOOL freed = HeapFree(GetProcessHeap(), 0, hashObject);
    ObserveBootstrap(control,"hash-storage-release",(ULONG_PTR)hashObject,freed,0,BOOTSTRAP_RESULT_HEAP,!freed);
    if (freed) control->hashStorage = NULL;
    else control->allocationReleaseFailed = 1;
  }
  if (control->allocationReleaseFailed) valid = 0;
  /* The caller still releases independently safe held directories before the
   * shared releaseFailed retention gate. Failed file identity stays in ledger. */
  if (!valid) { ReleaseBootstrapHandle(control,&file,"release-unverified-managed-file",0); return 0; }
  *heldHandle = file;
  return 1;
}

/* Called only after genuine original reader/process closure, or before any
 * child acquisition. Every independent safe release is observed before retention.
 * Pipe is deliberately separate: it is the last release after provisional terminal. */
static void ReleaseBootstrapResources(ConptyControl* control, PROCESS_INFORMATION* process,
    HANDLE* reader, HANDLE* heldFile, HANDLE* directories, DWORD count) {
  ReleaseBootstrapHandle(control,reader,"release-control-reader",0);
  ReleaseBootstrapHandle(control,&process->hThread,"release-managed-thread",0);
  ReleaseBootstrapHandle(control,&process->hProcess,"release-managed-process",0);
  ReleaseBootstrapHandle(control,&control->stopEvent,"release-stop-event",0);
  ReleaseBootstrapHandle(control,&control->job,"release-job",0);
  ReleaseBootstrapHandle(control,&control->owner,"release-control-owner",0);
  ReleaseBootstrapHandle(control,heldFile,"release-managed-file",0);
  ReleasePackageDirectories(control,directories,count);
}

static int RunBootstrapInvocation(ConptyControl* control) {
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
  HANDLE controlThread = NULL;
  int conptyMode;
  ZeroMemory(&processInformation, sizeof(processInformation));
  control->pipe = INVALID_HANDLE_VALUE;
  if (!SanitizeLoaderEnvironmentOwned(control)) return BOOTSTRAP_FAILURE_UNKNOWN;
  if (!GetSelfDirectory(directory, (DWORD)(sizeof(directory) / sizeof(directory[0])))) return BOOTSTRAP_FAILURE_BINDING;
  if (!VerifyPackageDirectory(control,directory, finalDirectory, (DWORD)_countof(finalDirectory), heldDirectories, &heldDirectoryCount)) return BOOTSTRAP_FAILURE_BINDING;
  if (_snwprintf_s(managedPath, _countof(managedPath), _TRUNCATE, L"%s\\%s", finalDirectory, MANAGED_LAUNCHER_NAME) < 0) { ReleasePackageDirectories(control,heldDirectories, heldDirectoryCount); return BOOTSTRAP_FAILURE_BINDING; }
  if (!VerifyManagedLauncher(control,managedPath, &heldHandle)) { ReleasePackageDirectories(control,heldDirectories, heldDirectoryCount); if (control->allocationReleaseFailed) RetainConpty(); return BOOTSTRAP_FAILURE_BINDING; }
  control->originalHeldFile = heldHandle;
  control->originalHeldDirectoryCount = heldDirectoryCount;
  memcpy(control->originalHeldDirectories,heldDirectories,heldDirectoryCount * sizeof(HANDLE));
  conptyMode = OpenConptyControl(control);
  if (conptyMode < 0) { exitCode = BOOTSTRAP_FAILURE_BINDING; goto release; }
  if (_snwprintf_s(commandLine, _countof(commandLine), _TRUNCATE, L"\"%s\"", managedPath) < 0) { exitCode = BOOTSTRAP_FAILURE_CREATE; goto release; }
  ZeroMemory(&startupInfo, sizeof(startupInfo));
  ZeroMemory(&processInformation, sizeof(processInformation));
  startupInfo.cb = sizeof(startupInfo);
  BOOL created = CreateProcessW(managedPath, commandLine, NULL, NULL, FALSE, conptyMode ? CREATE_SUSPENDED : 0, NULL, NULL, &startupInfo, &processInformation);
  DWORD createError = created ? 0 : GetLastError();
  control->originalChild = processInformation;
  ObserveBootstrap(control,"managed-child-create",(ULONG_PTR)processInformation.hProcess,created,createError,BOOTSTRAP_RESULT_WIN32,!created);
  if (!created) { exitCode = BOOTSTRAP_FAILURE_CREATE; goto release; }
  if (conptyMode) {
    BOOL assigned = AssignProcessToJobObject(control->job, processInformation.hProcess);
    DWORD assignError = assigned ? 0 : GetLastError();
    ObserveBootstrap(control,"managed-child-assign",(ULONG_PTR)processInformation.hProcess,assigned,assignError,BOOTSTRAP_RESULT_WIN32,!assigned);
    control->originalChildAssigned = assigned;
    if (!assigned) {
      BOOL terminated = TerminateProcess(processInformation.hProcess, BOOTSTRAP_FAILURE_CREATE);
      DWORD terminateError = terminated ? 0 : GetLastError();
      ObserveBootstrap(control,"unassigned-child-terminate",(ULONG_PTR)processInformation.hProcess,terminated,terminateError,BOOTSTRAP_RESULT_WIN32,!terminated);
      DWORD unassignedWait = WaitForSingleObject(processInformation.hProcess, INFINITE);
      DWORD unassignedError = unassignedWait == WAIT_FAILED ? GetLastError() : 0;
      ObserveBootstrap(control,"unassigned-child-wait",(ULONG_PTR)processInformation.hProcess,unassignedWait,unassignedError,unassignedWait == WAIT_FAILED ? BOOTSTRAP_RESULT_WIN32 : BOOTSTRAP_RESULT_VALUE,unassignedWait != WAIT_OBJECT_0);
      control->originalChildClosed = unassignedWait == WAIT_OBJECT_0;
      if (!control->originalChildClosed) RetainConpty();
      exitCode = BOOTSTRAP_FAILURE_CREATE; goto contained;
    }
    if (!WriteControlLine(control, "registered", GetCurrentProcessId(), 0) || !ReadControlCommand(control, "resume")) { exitCode = BOOTSTRAP_FAILURE_CREATE; goto contained; }
    controlThread = CreateThread(NULL, 0, ConptyCancelReader, control, 0, NULL);
    DWORD threadError = controlThread ? 0 : GetLastError();
    ObserveBootstrap(control,"control-reader-create",(ULONG_PTR)controlThread,controlThread != NULL,threadError,BOOTSTRAP_RESULT_WIN32,controlThread == NULL);
    if (controlThread == NULL) { exitCode = BOOTSTRAP_FAILURE_CREATE; goto contained; }
    DWORD resumed = ResumeThread(processInformation.hThread);
    DWORD resumeError = resumed == (DWORD)-1 ? GetLastError() : 0;
    ObserveBootstrap(control,"managed-child-resume",(ULONG_PTR)processInformation.hThread,resumed,resumeError,BOOTSTRAP_RESULT_WIN32,resumed == (DWORD)-1);
    if (resumed == (DWORD)-1) { exitCode = BOOTSTRAP_FAILURE_CREATE; goto contained; }
  }
  DWORD primaryWait = WaitForSingleObject(processInformation.hProcess, INFINITE);
  DWORD primaryWaitError = primaryWait == WAIT_FAILED ? GetLastError() : 0;
  ObserveBootstrap(control,"managed-child-primary-wait",(ULONG_PTR)processInformation.hProcess,primaryWait,primaryWaitError,primaryWait == WAIT_FAILED ? BOOTSTRAP_RESULT_WIN32 : BOOTSTRAP_RESULT_VALUE,primaryWait != WAIT_OBJECT_0);
  control->originalChildClosed = primaryWait == WAIT_OBJECT_0;
  /* Unknown original wait retains this actual invocation, including all held
   * inputs and live child, with neither a replacement wait nor a kill retry. */
  if (!control->originalChildClosed) RetainConpty();
  BOOL exitKnown = GetExitCodeProcess(processInformation.hProcess, &exitCode);
  DWORD exitError = exitKnown ? 0 : GetLastError();
  control->originalExitCode = exitCode;
  ObserveBootstrap(control,"managed-child-exit-query",(ULONG_PTR)processInformation.hProcess,exitKnown,exitError,BOOTSTRAP_RESULT_WIN32,!exitKnown);
  if (!exitKnown) exitCode = BOOTSTRAP_FAILURE_WAIT;
contained:
  /* Empty outer-job accounting is never an unassigned child's closure. */
  if (!control->originalChildAssigned && !control->originalChildClosed) RetainConpty();
  if (conptyMode) {
    if (!FinishConptyContainmentObserved(control, processInformation.hProcess, controlThread,control->originalChildClosed)) {
      /* No receipt: JavaScript retains inputs and does not enter caller cleanup. */
      exitCode = BOOTSTRAP_FAILURE_WAIT;
    } else {
      if (control->cancelled || control->failed) exitCode = BOOTSTRAP_FAILURE_WAIT;
    }
  }
release:
  ReleaseBootstrapResources(control,&processInformation,&controlThread,&heldHandle,heldDirectories,heldDirectoryCount);
  if (conptyMode > 0 && control->containmentDrain && control->containmentReader && control->containmentProcess) {
    if (!WriteControlLine(control,"terminal",GetCurrentProcessId(),exitCode)) exitCode = BOOTSTRAP_FAILURE_WAIT;
  }
  ReleaseBootstrapHandle(control,&control->pipe,"release-control-pipe",0);
  if (control->releaseFailed) RetainConpty();
  return (int)exitCode;
}

int wmain(void) {
  ConptyControl invocation;
  ZeroMemory(&invocation,sizeof(invocation));
  return RunBootstrapInvocation(&invocation);
}
