/* Prospective Win32 qualification fixture. Never part of compiler-only launch.
 * Includes the actual owning functions; no fake ReadFile/Job/zero evidence. */
#define wmain ConptyBootstrapEntrypoint
#include "../../src/runtime/execution/windows-managed-launcher-native-bootstrap.c"
#undef wmain

typedef struct { ConptyControl* control; volatile LONG result; } ReaderFixture;
static DWORD WINAPI ReadFixture(LPVOID argument) {
  ReaderFixture* fixture = (ReaderFixture*)argument;
  char line[256];
  fixture->result = ReadControlLine(fixture->control, line, sizeof(line));
  return 0;
}

static int OpenFixture(ConptyControl* control, HANDLE* server) {
  wchar_t name[256];
  _snwprintf_s(name, _countof(name), _TRUNCATE, L"\\\\.\\pipe\\conpty-io-fixture-%lu-%llu", GetCurrentProcessId(), GetTickCount64());
  ZeroMemory(control, sizeof(*control));
  control->stopEvent = CreateEventW(NULL, TRUE, FALSE, NULL);
  *server = CreateNamedPipeW(name, PIPE_ACCESS_DUPLEX | FILE_FLAG_OVERLAPPED, PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT, 1, 1024, 1024, 0, NULL);
  if (*server == INVALID_HANDLE_VALUE || control->stopEvent == NULL) return 0;
  control->pipe = CreateFileW(name, GENERIC_READ | GENERIC_WRITE, 0, NULL, OPEN_EXISTING, FILE_FLAG_OVERLAPPED, NULL);
  return control->pipe != INVALID_HANDLE_VALUE;
}
static int WriteFixture(HANDLE pipe, const char* bytes, DWORD length) {
  OVERLAPPED operation; DWORD written = 0;
  ZeroMemory(&operation, sizeof(operation)); operation.hEvent = CreateEventW(NULL, TRUE, FALSE, NULL);
  int result = WriteFile(pipe, bytes, length, &written, &operation);
  if (!result && GetLastError() == ERROR_IO_PENDING) result = GetOverlappedResult(pipe, &operation, &written, TRUE);
  CloseHandle(operation.hEvent); return result && written == length;
}
static int StoppedRead(int partial) {
  ConptyControl control; HANDLE server, reader;
  if (!OpenFixture(&control, &server)) return 0;
  ReaderFixture fixture = { &control, -1 };
  if (partial && !WriteFixture(server, "can", 3)) return 0;
  reader = CreateThread(NULL, 0, ReadFixture, &fixture, CREATE_SUSPENDED, NULL);
  if (reader == NULL) return 0;
  if (!partial) SetEvent(control.stopEvent); /* stop before reader is scheduled */
  ResumeThread(reader);
  if (partial) {
    /* Independently observe the original client buffer was consumed. */
    DWORD remaining = 3;
    ULONGLONG deadline = GetTickCount64() + 5000;
    while (remaining && GetTickCount64() < deadline) {
      if (!PeekNamedPipe(control.pipe, NULL, 0, NULL, &remaining, NULL)) return 0;
      Sleep(1);
    }
    if (remaining) return 0;
    SetEvent(control.stopEvent); /* pending next read, not completed command */
  }
  int complete = WaitForSingleObject(reader, 5000) == WAIT_OBJECT_0 && fixture.result == 0;
  if (!complete) return 0; /* retained failure; never TerminateThread */
  CloseHandle(reader); CloseHandle(control.pipe); CloseHandle(server); CloseHandle(control.stopEvent);
  return 1;
}

static int SuspendedResumeFailure(void) {
  ConptyControl control; HANDLE server;
  if (!OpenFixture(&control, &server)) return 0;
  control.job = CreateJobObjectW(NULL, NULL);
  JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits;
  ZeroMemory(&limits, sizeof(limits)); limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
  if (!control.job || !SetInformationJobObject(control.job, JobObjectExtendedLimitInformation, &limits, sizeof(limits))) return 0;
  wchar_t image[32768], command[32770];
  if (!GetModuleFileNameW(NULL, image, _countof(image))) return 0;
  _snwprintf_s(command, _countof(command), _TRUNCATE, L"\"%s\" --hold", image);
  STARTUPINFOW startup; PROCESS_INFORMATION process;
  ZeroMemory(&startup, sizeof(startup)); startup.cb = sizeof(startup); ZeroMemory(&process, sizeof(process));
  if (!CreateProcessW(image, command, NULL, NULL, FALSE, CREATE_SUSPENDED, NULL, NULL, &startup, &process)) return 0;
  if (!AssignProcessToJobObject(control.job, process.hProcess)) return 0;
  CloseHandle(process.hThread);
  SetLastError(0);
  if (ResumeThread(process.hThread) != (DWORD)-1 || GetLastError() != ERROR_INVALID_HANDLE) return 0;
  ReaderFixture fixture = { &control, -1 };
  HANDLE reader = CreateThread(NULL, 0, ReadFixture, &fixture, 0, NULL);
  int terminal = reader && FinishConptyContainment(&control, process.hProcess, reader);
  JOBOBJECT_BASIC_ACCOUNTING_INFORMATION accounting;
  int zero = QueryInformationJobObject(control.job, JobObjectBasicAccountingInformation, &accounting, sizeof(accounting), NULL) && accounting.ActiveProcesses == 0;
  if (!terminal || !zero || fixture.result != 0 || WaitForSingleObject(process.hProcess, 0) != WAIT_OBJECT_0) return 0;
  CloseHandle(reader); CloseHandle(process.hProcess); CloseHandle(control.job); CloseHandle(control.pipe); CloseHandle(server); CloseHandle(control.stopEvent);
  return 1;
}
static int NaturalOrLostRead(int lost) {
  ConptyControl control; HANDLE server;
  if (!OpenFixture(&control, &server)) return 0;
  ReaderFixture fixture = { &control, -1 };
  HANDLE reader = CreateThread(NULL, 0, ReadFixture, &fixture, 0, NULL);
  if (!reader) return 0;
  if (lost) { CloseHandle(server); server = INVALID_HANDLE_VALUE; }
  else if (!WriteFixture(server, "cancel:fixture\n", 15)) return 0;
  if (WaitForSingleObject(reader, 5000) != WAIT_OBJECT_0 || fixture.result != (lost ? 0 : 1)) return 0;
  CloseHandle(reader); CloseHandle(control.pipe); if (server != INVALID_HANDLE_VALUE) CloseHandle(server); CloseHandle(control.stopEvent);
  return 1;
}
int wmain(int argc, wchar_t** argv) {
  if (argc == 2 && wcscmp(argv[1], L"--hold") == 0) { Sleep(INFINITE); return 1; }
  return StoppedRead(0) && StoppedRead(1) && NaturalOrLostRead(0) && NaturalOrLostRead(1) && SuspendedResumeFailure() ? 0 : 1;
}
