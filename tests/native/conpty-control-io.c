/* Prospective original Win32 fixtures: SOURCE ONLY until separately admitted. */
#define wmain ConptyBootstrapEntrypoint
#include "../../src/runtime/execution/windows-managed-launcher-native-bootstrap.c"
#undef wmain

typedef struct FixtureOwner FixtureOwner;
typedef struct { ConptyControl* control; volatile LONG result; } ReaderFixture;
typedef struct { const char* site; DWORD code; int native; } FixtureFailure;
struct FixtureOwner {
  FixtureOwner* next;
  ConptyControl control;
  ReaderFixture argument;
  HANDLE server, reader, child, childThread;
  OVERLAPPED write;
  DWORD written;
  char writeBytes[256];
  int readerResumed, assigned, childTerminal, readerTerminal, closed;
  int stopIssued, stopKnown, productionTerminal;
  unsigned closeAttempted;
  unsigned failures;
  FixtureFailure ledger[64];
};
static FixtureOwner* originalOwners;
static void Failure(FixtureOwner* o, const char* site, DWORD code, int native) {
  if (o->failures == _countof(o->ledger)) { Sleep(INFINITE); abort(); }
  o->ledger[o->failures].site = site; o->ledger[o->failures].code = code;
  o->ledger[o->failures++].native = native;
}
static void NativeFailure(FixtureOwner* o, const char* site) { DWORD code = GetLastError(); Failure(o, site, code, 1); }
static void RetainOriginal(FixtureOwner* o, const char* site) {
  Failure(o, site, ERROR_IO_INCOMPLETE, 0);
  /* originalOwners keeps stable control/arguments/operations/handles/ledger.
   * This SAME invocation never returns, closes, retries or reports success. */
  Sleep(INFINITE); abort();
}
static FixtureOwner* NewOwner(void) {
  FixtureOwner* o = (FixtureOwner*)HeapAlloc(GetProcessHeap(), HEAP_ZERO_MEMORY, sizeof(*o));
  if (!o) return NULL;
  o->server = INVALID_HANDLE_VALUE; o->control.pipe = INVALID_HANDLE_VALUE;
  o->argument.control = &o->control; o->argument.result = -1;
  o->next = originalOwners; originalOwners = o; return o;
}
static int CloseOriginal(FixtureOwner* o, HANDLE* handle, const char* site) {
  if (*handle == NULL || *handle == INVALID_HANDLE_VALUE) return 1;
  HANDLE* slots[] = { &o->reader, &o->childThread, &o->child, &o->control.job,
    &o->write.hEvent, &o->control.pipe, &o->server, &o->control.stopEvent };
  unsigned bit = 0;
  for (unsigned i = 0; i < _countof(slots); i++) if (slots[i] == handle) bit = 1u << i;
  if (!bit) RetainOriginal(o,"unregistered-handle-release");
  if (o->closeAttempted & bit) return 0; /* retain original failed close, never retry */
  o->closeAttempted |= bit;
  if (!CloseHandle(*handle)) { NativeFailure(o, site); return 0; }
  *handle = NULL; return 1;
}
static int StopOriginal(FixtureOwner* o, const char* site) {
  if (o->stopIssued) return o->stopKnown;
  o->stopIssued = 1;
  if (!SetEvent(o->control.stopEvent)) { NativeFailure(o,site); return 0; }
  o->stopKnown = 1; return 1;
}
static DWORD WINAPI ReadFixture(LPVOID argument) {
  ReaderFixture* fixture = (ReaderFixture*)argument;
  char line[256]; fixture->result = ReadControlLine(fixture->control, line, sizeof(line)); return 0;
}
static int Checkpoint(FixtureOwner* o, int selected, int point) {
  if (selected != point) return 1;
  Failure(o, "prospective-post-create-checkpoint", (DWORD)point, 0); return 0;
}
static int OpenFixture(FixtureOwner* o, int selected) {
  wchar_t name[256];
  if (_snwprintf_s(name, _countof(name), _TRUNCATE, L"\\\\.\\pipe\\conpty-io-fixture-%lu-%llu", GetCurrentProcessId(), GetTickCount64()) < 0) { Failure(o,"pipe-name",0,0); return 0; }
  o->control.stopEvent = CreateEventW(NULL, TRUE, FALSE, NULL);
  if (!o->control.stopEvent) { NativeFailure(o,"create-stop-event"); return 0; }
  if (!Checkpoint(o,selected,1)) return 0;
  o->server = CreateNamedPipeW(name, PIPE_ACCESS_DUPLEX | FILE_FLAG_OVERLAPPED, PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT, 1,1024,1024,0,NULL);
  if (o->server == INVALID_HANDLE_VALUE) { NativeFailure(o,"create-server"); return 0; }
  if (!Checkpoint(o,selected,2)) return 0;
  o->control.pipe = CreateFileW(name, GENERIC_READ | GENERIC_WRITE,0,NULL,OPEN_EXISTING,FILE_FLAG_OVERLAPPED,NULL);
  if (o->control.pipe == INVALID_HANDLE_VALUE) { NativeFailure(o,"open-client"); return 0; }
  return Checkpoint(o,selected,3);
}
static int WriteFixture(FixtureOwner* o, const char* bytes, DWORD length, int selected) {
  if (length > sizeof(o->writeBytes)) { Failure(o,"write-cap",0,0); return 0; }
  memcpy(o->writeBytes,bytes,length); ZeroMemory(&o->write,sizeof(o->write));
  o->write.hEvent = CreateEventW(NULL,TRUE,FALSE,NULL);
  if (!o->write.hEvent) { NativeFailure(o,"write-event"); return 0; }
  if (!Checkpoint(o,selected,4)) return 0;
  BOOL result = WriteFile(o->server,o->writeBytes,length,&o->written,&o->write);
  if (!result) {
    DWORD code = GetLastError();
    if (code == ERROR_IO_PENDING) {
      result = GetOverlappedResult(o->server,&o->write,&o->written,TRUE);
      if (!result) {
        code = GetLastError(); Failure(o,"original-write-completion",code,1);
        if (code != ERROR_OPERATION_ABORTED && code != ERROR_BROKEN_PIPE) RetainOriginal(o,"unknown-original-write-completion");
      }
    } else Failure(o,"write-issuance",code,1);
  }
  if (result && o->written != length) { Failure(o,"short-write",0,0); result = FALSE; }
  return result && Checkpoint(o,selected,5);
}
static int StartReader(FixtureOwner* o, int selected) {
  o->reader = CreateThread(NULL,0,ReadFixture,&o->argument,CREATE_SUSPENDED,NULL);
  if (!o->reader) { NativeFailure(o,"create-reader"); return 0; }
  if (ResumeThread(o->reader) == (DWORD)-1) { NativeFailure(o,"resume-reader"); return 0; }
  o->readerResumed = 1; return Checkpoint(o,selected,6);
}
static int FinishOwner(FixtureOwner* o) {
  int stopKnown = 1, jobKnown = 1, releaseKnown = 1;
  InterlockedExchange(&o->control.stopping,1);
  if (o->control.stopEvent && !StopOriginal(o,"original-stop")) stopKnown = 0;
  /* Child containment precedes reader join, and both original observations are independent. */
  if (o->child) {
    if (o->assigned && !o->productionTerminal) {
      if (!TerminateJobObject(o->control.job,BOOTSTRAP_FAILURE_WAIT)) { NativeFailure(o,"original-job-terminate"); jobKnown = 0; }
      if (jobKnown) for (;;) {
        JOBOBJECT_BASIC_ACCOUNTING_INFORMATION a;
        if (!QueryInformationJobObject(o->control.job,JobObjectBasicAccountingInformation,&a,sizeof(a),NULL)) { NativeFailure(o,"original-job-accounting"); jobKnown = 0; break; }
        if (a.ActiveProcesses == 0) break;
        Sleep(1);
      }
    } else if (!o->assigned && !TerminateProcess(o->child,BOOTSTRAP_FAILURE_WAIT)) NativeFailure(o,"original-unassigned-child-terminate");
    if (WaitForSingleObject(o->child,INFINITE) == WAIT_OBJECT_0) o->childTerminal = 1;
    else NativeFailure(o,"original-child-wait");
  }
  if (o->reader) {
    if (!o->readerResumed) RetainOriginal(o,"original-reader-still-suspended");
    if (WaitForSingleObject(o->reader,INFINITE) == WAIT_OBJECT_0) o->readerTerminal = 1;
    else NativeFailure(o,"original-reader-wait");
  }
  if (!stopKnown || !jobKnown || (o->child && !o->childTerminal) || (o->reader && !o->readerTerminal)) RetainOriginal(o,"unknown-original-closure");
  /* Independent releases do not short circuit after an earlier close failure. */
  if (!CloseOriginal(o,&o->reader,"close-reader")) releaseKnown = 0;
  if (!CloseOriginal(o,&o->childThread,"close-child-thread")) releaseKnown = 0;
  if (!CloseOriginal(o,&o->child,"close-child")) releaseKnown = 0;
  if (!CloseOriginal(o,&o->control.job,"close-job")) releaseKnown = 0;
  if (!CloseOriginal(o,&o->write.hEvent,"close-write-event")) releaseKnown = 0;
  if (!CloseOriginal(o,&o->control.pipe,"close-client")) releaseKnown = 0;
  if (!CloseOriginal(o,&o->server,"close-server")) releaseKnown = 0;
  if (!CloseOriginal(o,&o->control.stopEvent,"close-stop-event")) releaseKnown = 0;
  if (!releaseKnown) RetainOriginal(o,"unknown-original-handle-release");
  o->closed = 1; return o->failures == 0;
}
static int StoppedRead(int partial, int selected) {
  FixtureOwner* o = NewOwner(); if (!o) return 0;
  if (!OpenFixture(o,selected)) goto finish;
  if (partial && !WriteFixture(o,"can",3,selected)) goto finish;
  if (!partial && !StopOriginal(o,"stop-before-read")) goto finish;
  if (!StartReader(o,selected)) goto finish;
  if (partial) {
    DWORD remaining = 3; ULONGLONG deadline = GetTickCount64() + 5000;
    while (remaining && GetTickCount64() < deadline) {
      if (!PeekNamedPipe(o->control.pipe,NULL,0,NULL,&remaining,NULL)) { NativeFailure(o,"peek-original-client"); goto finish; }
      Sleep(1);
    }
    if (remaining) { Failure(o,"original-partial-read-deadline",WAIT_TIMEOUT,0); goto finish; }
    if (!Checkpoint(o,selected,7)) goto finish;
    if (!StopOriginal(o,"stop-partial-read")) goto finish;
  }
  DWORD waited = WaitForSingleObject(o->reader,5000);
  if (waited != WAIT_OBJECT_0) { if (waited == WAIT_FAILED) NativeFailure(o,"reader-assertion-wait"); else Failure(o,"reader-assertion-deadline",waited,0); }
  else if (o->argument.result != 0) Failure(o,"stopped-reader-result",0,0);
finish:
  { int result = FinishOwner(o); return selected ? (!result && o->closed && o->failures && o->ledger[0].code == (DWORD)selected && !o->ledger[0].native && o->failures == 1) : result; }
}
static int NaturalOrLostRead(int lost) {
  FixtureOwner* o = NewOwner(); if (!o) return 0;
  if (!OpenFixture(o,0) || !StartReader(o,0)) goto finish;
  if (lost) { if (!CloseOriginal(o,&o->server,"original-lost-server-close")) goto finish; }
  else if (!WriteFixture(o,"cancel:fixture\n",15,0)) goto finish;
  DWORD waited = WaitForSingleObject(o->reader,5000);
  if (waited != WAIT_OBJECT_0) { if (waited == WAIT_FAILED) NativeFailure(o,"natural-reader-wait"); else Failure(o,"natural-reader-deadline",waited,0); }
  else if (o->argument.result != (lost ? 0 : 1)) Failure(o,"natural-reader-result",0,0);
finish: return FinishOwner(o);
}
static int SuspendedResumeFailure(int selected) {
  FixtureOwner* o = NewOwner(); if (!o) return 0;
  if (!OpenFixture(o,0)) goto finish;
  o->control.job = CreateJobObjectW(NULL,NULL);
  if (!o->control.job) { NativeFailure(o,"create-job"); goto finish; }
  if (!Checkpoint(o,selected,8)) goto finish;
  JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits; ZeroMemory(&limits,sizeof(limits)); limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
  if (!SetInformationJobObject(o->control.job,JobObjectExtendedLimitInformation,&limits,sizeof(limits))) { NativeFailure(o,"job-limit"); goto finish; }
  if (!Checkpoint(o,selected,9)) goto finish;
  wchar_t image[32768], command[32770];
  DWORD n = GetModuleFileNameW(NULL,image,_countof(image));
  if (!n || n >= _countof(image)) { NativeFailure(o,"original-fixture-image"); goto finish; }
  if (_snwprintf_s(command,_countof(command),_TRUNCATE,L"\"%s\" --hold",image) < 0) { Failure(o,"child-command",0,0); goto finish; }
  STARTUPINFOW startup; PROCESS_INFORMATION process; ZeroMemory(&startup,sizeof(startup)); startup.cb = sizeof(startup); ZeroMemory(&process,sizeof(process));
  if (!CreateProcessW(image,command,NULL,NULL,FALSE,CREATE_SUSPENDED,NULL,NULL,&startup,&process)) { NativeFailure(o,"create-suspended-child"); goto finish; }
  o->child = process.hProcess; o->childThread = process.hThread;
  if (!Checkpoint(o,selected,10)) goto finish; /* actual unassigned exact child */
  if (!AssignProcessToJobObject(o->control.job,o->child)) { NativeFailure(o,"assign-original-child"); goto finish; }
  o->assigned = 1; if (!Checkpoint(o,selected,11)) goto finish;
  HANDLE originalClosedThread = o->childThread;
  if (!CloseOriginal(o,&o->childThread,"original-resume-test-thread-close")) goto finish;
  SetLastError(0); DWORD resumed = ResumeThread(originalClosedThread); DWORD resumeError = GetLastError();
  if (resumed != (DWORD)-1 || resumeError != ERROR_INVALID_HANDLE) { Failure(o,"actual-invalid-resume-contract",resumeError,0); goto finish; }
  if (!Checkpoint(o,selected,12) || !StartReader(o,0)) goto finish;
  /* Exercise actual production containment; ownership remains with o on failure. */
  o->stopIssued = 1;
  if (!FinishConptyContainment(&o->control,o->child,o->reader)) { NativeFailure(o,"production-containment"); RetainOriginal(o,"production-containment-result-unknown"); }
  o->productionTerminal = 1; o->stopKnown = 1;
  o->readerTerminal = 1; o->childTerminal = 1;
  JOBOBJECT_BASIC_ACCOUNTING_INFORMATION accounting;
  if (!QueryInformationJobObject(o->control.job,JobObjectBasicAccountingInformation,&accounting,sizeof(accounting),NULL)) NativeFailure(o,"original-positive-accounting");
  else if (accounting.ActiveProcesses != 0 || o->argument.result != 0 || WaitForSingleObject(o->child,0) != WAIT_OBJECT_0) Failure(o,"positive-containment-contract",0,0);
finish:
  { int result = FinishOwner(o); return selected ? (!result && o->closed && o->failures == 1 && o->ledger[0].code == (DWORD)selected && !o->ledger[0].native) : result; }
}
int wmain(int argc, wchar_t** argv) {
  if (argc == 2 && wcscmp(argv[1],L"--hold") == 0) { Sleep(INFINITE); return 1; }
  int ok = StoppedRead(0,0) && StoppedRead(1,0) && NaturalOrLostRead(0) && NaturalOrLostRead(1) && SuspendedResumeFailure(0);
  /* Independent native counterparts; no fake API, handle, completion or zero. */
  for (int point = 1; point <= 7; point++) if (!StoppedRead(1,point)) ok = 0;
  for (int point = 8; point <= 12; point++) if (!SuspendedResumeFailure(point)) ok = 0;
  return ok ? 0 : 1;
}
