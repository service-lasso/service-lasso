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
  unsigned failures; int ledgerOverflow;
  volatile LONG ledgerLock;
  FixtureFailure ledger[64];
  PROCESS_INFORMATION bootstrapProcess;
  HANDLE bootstrapReader, bootstrapFile, bootstrapDirectories[2];
};
static FixtureOwner* originalOwners;
static void Failure(FixtureOwner* o, const char* site, DWORD code, int native) {
  while (InterlockedCompareExchange(&o->ledgerLock,1,0)) Sleep(0);
  if (o->failures == _countof(o->ledger)) { o->ledgerOverflow = 1; for (;;) Sleep(INFINITE); }
  o->ledger[o->failures].site = site; o->ledger[o->failures].code = code;
  o->ledger[o->failures++].native = native;
  InterlockedExchange(&o->ledgerLock,0);
}
static void ObserveOriginalFailure(void* owner, const char* site, DWORD code, int native) {
  Failure((FixtureOwner*)owner,site,code,native);
}
static void NativeFailure(FixtureOwner* o, const char* site) { DWORD code = GetLastError(); Failure(o, site, code, 1); }
static void RetainOriginal(FixtureOwner* o, const char* site) {
  Failure(o, site, ERROR_IO_INCOMPLETE, 0);
  /* originalOwners keeps stable control/arguments/operations/handles/ledger.
   * This SAME invocation never returns, closes, retries or reports success. */
  for (;;) Sleep(INFINITE);
}
static FixtureOwner* NewOwner(void) {
  FixtureOwner* o = (FixtureOwner*)HeapAlloc(GetProcessHeap(), HEAP_ZERO_MEMORY, sizeof(*o));
  if (!o) return NULL;
  o->server = INVALID_HANDLE_VALUE; o->control.pipe = INVALID_HANDLE_VALUE;
  o->argument.control = &o->control; o->argument.result = -1;
  o->control.observeFailure = ObserveOriginalFailure; o->control.observationOwner = o;
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
      jobKnown = DrainConptyJob(&o->control); // same once-only original disposition
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
  if (!FinishConptyContainment(&o->control,o->child,o->reader)) RetainOriginal(o,"production-containment-result-unknown");
  o->productionTerminal = o->control.containmentDrain;
  o->stopKnown = o->control.containmentStop;
  o->readerTerminal = o->control.containmentReader;
  o->childTerminal = o->control.containmentProcess;
  JOBOBJECT_BASIC_ACCOUNTING_INFORMATION accounting;
  if (!QueryInformationJobObject(o->control.job,JobObjectBasicAccountingInformation,&accounting,sizeof(accounting),NULL)) NativeFailure(o,"original-positive-accounting");
  else if (accounting.ActiveProcesses != 0 || o->argument.result != 0 || WaitForSingleObject(o->child,0) != WAIT_OBJECT_0) Failure(o,"positive-containment-contract",0,0);
finish:
  { int result = FinishOwner(o); return selected ? (!result && o->closed && o->failures == 1 && o->ledger[0].code == (DWORD)selected && !o->ledger[0].native) : result; }
}
static int ActualReadError(int stopError) {
  FixtureOwner* o = NewOwner(); if (!o) return 0;
  if (!OpenFixture(o,0)) { FinishOwner(o); return 0; }
  /* Genuine original resource acquisition/release, then the actual shared
   * API receives that closed slot. No API wrapper or fabricated result. */
  if (!CloseOriginal(o,stopError ? &o->control.stopEvent : &o->control.pipe,"read-error-original-close")) { FinishOwner(o); return 0; }
  char line[256]; int result = ReadControlLine(&o->control,line,sizeof(line));
  int matched = result == -1 && o->failures == 1 && o->ledger[0].native &&
    o->ledger[0].code == ERROR_INVALID_HANDLE &&
    strcmp(o->ledger[0].site,stopError ? "read-stop-observation" : "read-issuance") == 0;
  ConptyReadOwner* read = o->control.reads;
  matched = matched && read && read->closed && read->closeAttempted && !read->issued;
  int finished = FinishOwner(o);
  return matched && !finished && o->closed && o->failures == 1;
}
static int ActualDrainError(void) {
  FixtureOwner* o = NewOwner(); if (!o) return 0;
  o->control.job = CreateJobObjectW(NULL,NULL);
  if (!o->control.job) { NativeFailure(o,"error-case-job-create"); FinishOwner(o); return 0; }
  HANDLE originalJob = o->control.job;
  if (!CloseOriginal(o,&o->control.job,"error-case-job-close")) { FinishOwner(o); return 0; }
  o->control.job = originalJob; // artificial original closed number, with reuse caveat
  int drained = DrainConptyJob(&o->control);
  int second = TerminateOriginalConptyJob(&o->control,"must-not-be-issued");
  o->control.job = NULL; // borrowed closed value, never close/retry
  /* Another genuine API after the failed seam cannot replace its origin. */
  HANDLE later = CreateEventW(NULL,TRUE,FALSE,NULL);
  if (!later) { NativeFailure(o,"error-case-later-event"); FinishOwner(o); return 0; }
  BOOL laterClosed = CloseHandle(later);
  if (!laterClosed) { NativeFailure(o,"error-case-later-event-close"); RetainOriginal(o,"error-case-later-release-unknown"); }
  int matched = !drained && o->failures == 2 && o->ledger[0].native &&
    o->ledger[0].code == ERROR_INVALID_HANDLE && strcmp(o->ledger[0].site,"containment-job-terminate") == 0 &&
    o->control.terminationCount == 1 && o->control.termination[0].failure &&
    o->control.terminationOrdinal == 1 && o->control.terminationDisposition == 2 &&
    o->control.containmentCount == 1 && o->control.containment[0].failure &&
    strcmp(o->control.containment[0].site,"containment-job-accounting") == 0;
  // A second caller reads the original outcome, never retries its failed call.
  matched = matched && !second && o->control.terminationCount == 1 && o->failures == 2;
  int finished = FinishOwner(o);
  return matched && !finished && o->closed && o->failures == 2;
}
static int ActualWriteError(void) {
  FixtureOwner* o = NewOwner(); if (!o) return 0;
  if (!OpenFixture(o,0)) { FinishOwner(o); return 0; }
  HANDLE originalPipe = o->control.pipe;
  if (!CloseOriginal(o,&o->control.pipe,"write-error-original-close")) { FinishOwner(o); return 0; }
  /* Artificial acquired-then-closed numeric handle regression, not an ordinary
   * original-release failure. WriteControlLine may acquire/reuse handle values;
   * only the real API observation can qualify this prospective case. */
  o->control.pipe = originalPipe;
  int result = WriteControlLine(&o->control,"registered",GetCurrentProcessId(),0);
  o->control.pipe = NULL; /* borrowed closed value; never close/retry it */
  ConptyWriteOwner* write = o->control.writes;
  int matched = !result && write && !write->issued && write->closed && write->closeAttempted &&
    o->failures == 1 && o->ledger[0].native && o->ledger[0].code == ERROR_INVALID_HANDLE &&
    strcmp(o->ledger[0].site,"write-issuance") == 0;
  int finished = FinishOwner(o);
  return matched && !finished && o->closed && o->failures == 1;
}
static int NaturalControlWrites(void) {
  FixtureOwner* o = NewOwner(); if (!o) return 0;
  if (!OpenFixture(o,0)) { FinishOwner(o); return 0; }
  for (unsigned i = 0; i < 64; i++) o->control.token[i] = L'a';
  if (!WriteControlLine(&o->control,"registered",123,0) || !WriteControlLine(&o->control,"terminal",123,7)) {
    Failure(o,"positive-control-write",0,0); FinishOwner(o); return 0;
  }
  const char* expected = "registered:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:123:0:0\nterminal:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:123:7:0\n";
  o->write.hEvent = CreateEventW(NULL,TRUE,FALSE,NULL);
  if (!o->write.hEvent) { NativeFailure(o,"positive-control-read-event"); FinishOwner(o); return 0; }
  BOOL read = ReadFile(o->server,o->writeBytes,(DWORD)strlen(expected),&o->written,&o->write);
  DWORD error = read ? 0 : GetLastError();
  if (!read && error == ERROR_IO_PENDING) {
    read = GetOverlappedResult(o->server,&o->write,&o->written,TRUE);
    error = read ? 0 : GetLastError();
    if (!read) { Failure(o,"positive-control-read-completion",error,1); RetainOriginal(o,"positive-control-read-unknown"); }
  }
  if (!read || o->written != strlen(expected) || memcmp(o->writeBytes,expected,strlen(expected))) Failure(o,"positive-control-protocol-bytes",error,read ? 0 : 1);
  for (ConptyWriteOwner* write = o->control.writes; write; write = write->next)
    if (!write->issued || !write->completed || !write->closed || write->written != (DWORD)write->length || write->cancelAttempted) Failure(o,"positive-control-owner-closure",0,0);
  return FinishOwner(o);
}
/* Separate prospective NONRETURNING cases. An external independently admitted
 * observer must qualify SAME owner retention and original ledger; process exit
 * or a deadline is never the assertion. These cases are not default positives. */
static int ActualWriteRetentionCase(int closeEvent) {
  FixtureOwner* o = NewOwner(); if (!o) return 0;
  if (!OpenFixture(o,0)) { FinishOwner(o); return 0; }
  ConptyWriteOwner* write = (ConptyWriteOwner*)HeapAlloc(GetProcessHeap(),HEAP_ZERO_MEMORY,sizeof(*write));
  if (!write) { Failure(o,"retention-write-allocation",ERROR_NOT_ENOUGH_MEMORY,0); FinishOwner(o); return 0; }
  write->next = o->control.writes; o->control.writes = write;
  write->operation.hEvent = CreateEventW(NULL,TRUE,FALSE,NULL);
  if (!write->operation.hEvent) { NativeFailure(o,"retention-write-event"); FinishOwner(o); return 0; }
  if (closeEvent) {
    HANDLE originalEvent = write->operation.hEvent;
    if (!CloseHandle(originalEvent)) { NativeFailure(o,"retention-original-event-close"); RetainOriginal(o,"retention-original-event-release"); }
    // Actual previously acquired event; no intervening handle acquisition/reuse.
    CloseControlWrite(&o->control,write);
  } else {
    for (unsigned index = 0;; index++) {
      write->length = sizeof(write->line); memset(write->line,'x',sizeof(write->line));
      BOOL issued = WriteFile(o->control.pipe,write->line,(DWORD)write->length,&write->written,&write->operation);
      DWORD issueError = issued ? 0 : GetLastError();
      ObserveConpty(&o->control,write->ledger,&write->observations,_countof(write->ledger),"write-issuance",issueError,1,!issued && issueError != ERROR_IO_PENDING);
      if (!issued && issueError == ERROR_IO_PENDING) { write->issued = 1; break; }
      if (!issued || write->written != (DWORD)write->length || index == 4095) {
        Failure(o,"retention-case-original-write-not-pending",issueError,1);
        CloseControlWrite(&o->control,write); FinishOwner(o); return 0;
      }
      write->issued = 1; write->completed = 1; CloseControlWrite(&o->control,write);
      // Each fill is a NEW original operation with separate stable storage, never
      // a retry of a failed/pending write. No server reads drain this bounded fill.
      write = (ConptyWriteOwner*)HeapAlloc(GetProcessHeap(),HEAP_ZERO_MEMORY,sizeof(*write));
      if (!write) RetainOriginal(o,"retention-fill-owner-allocation");
      write->next = o->control.writes; o->control.writes = write;
      write->operation.hEvent = CreateEventW(NULL,TRUE,FALSE,NULL);
      if (!write->operation.hEvent) { NativeFailure(o,"retention-fill-event"); RetainOriginal(o,"retention-fill-event-failed"); }
    }
    HANDLE originalPipe = o->control.pipe;
    if (!CloseHandle(originalPipe)) { NativeFailure(o,"retention-original-pipe-close"); RetainOriginal(o,"retention-original-pipe-release"); }
    // The actual API receives the original closed handle; result is not injected.
    CompleteControlWrite(&o->control,write);
  }
  Failure(o,"retention-case-unexpected-return",0,0); RetainOriginal(o,"retention-case-failed-contract"); return 0;
}
static DWORD WINAPI CompletedBootstrapReader(LPVOID parameter) { (void)parameter; return 0; }
/* Actual production reader, original acquired job/child/pipe, followed by the
 * actual finisher. No substituted reader or native result. All cases UNRUN. */
static int ProductionCancelReaderCase(int kind) {
  FixtureOwner* o = NewOwner(); if (!o) return 0;
  if (!OpenFixture(o,0)) { FinishOwner(o); return 0; }
  for (unsigned i = 0; i < 64; i++) o->control.token[i] = L'a';
  o->control.job = CreateJobObjectW(NULL,NULL);
  if (!o->control.job) { NativeFailure(o,"cancel-case-job-create"); FinishOwner(o); return 0; }
  wchar_t image[32768], command[32770];
  DWORD length = GetModuleFileNameW(NULL,image,_countof(image));
  if (!length || length >= _countof(image)) RetainOriginal(o,"cancel-case-image");
  if (_snwprintf_s(command,_countof(command),_TRUNCATE,L"\"%s\" --hold",image) < 0) RetainOriginal(o,"cancel-case-command");
  STARTUPINFOW startup; PROCESS_INFORMATION process; ZeroMemory(&startup,sizeof(startup)); startup.cb = sizeof(startup);
  if (!CreateProcessW(image,command,NULL,NULL,FALSE,CREATE_SUSPENDED,NULL,NULL,&startup,&process)) {
    NativeFailure(o,"cancel-case-child-create"); FinishOwner(o); return 0;
  }
  o->child = process.hProcess; o->childThread = process.hThread;
  if (!AssignProcessToJobObject(o->control.job,o->child)) { NativeFailure(o,"cancel-case-child-assign"); FinishOwner(o); return 0; }
  o->assigned = 1;
  o->reader = CreateThread(NULL,0,ConptyCancelReader,&o->control,0,NULL);
  if (!o->reader) { NativeFailure(o,"cancel-case-reader-create"); FinishOwner(o); return 0; }
  o->readerResumed = 1;
  if (kind == 1) {
    if (!CloseOriginal(o,&o->server,"cancel-case-lost-channel")) RetainOriginal(o,"cancel-case-lost-close");
  } else if (kind != 2) {
    const char* cancel = "cancel:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n";
    if (!WriteFixture(o,cancel,(DWORD)strlen(cancel),0)) RetainOriginal(o,"cancel-case-write-failed");
  }
  if (kind < 2) {
    DWORD waited = WaitForSingleObject(o->reader,5000);
    if (waited != WAIT_OBJECT_0) Failure(o,"cancel-case-original-reader-5s",waited,0);
  }
  o->stopIssued = 1;
  if (!FinishConptyContainment(&o->control,o->child,o->reader)) RetainOriginal(o,"cancel-case-containment-unknown");
  o->productionTerminal = o->control.containmentDrain; o->stopKnown = o->control.containmentStop;
  o->readerTerminal = o->control.containmentReader; o->childTerminal = o->control.containmentProcess;
  int matched = o->control.terminationCount == 1 && o->control.terminationOrdinal == 1 &&
    o->control.terminationDisposition == 2 && o->control.terminationOriginal == o->control.job &&
    o->control.terminationSucceeded && !o->control.termination[0].failure &&
    (kind == 3 ? (!strcmp(o->control.termination[0].site,"cancel-reader-job-terminate") ||
      !strcmp(o->control.termination[0].site,"containment-job-terminate")) :
      !strcmp(o->control.termination[0].site,kind < 2 ? "cancel-reader-job-terminate" : "containment-job-terminate")) &&
    (kind == 3 ? 1 : kind == 0 ? o->control.cancelled == 1 : o->control.cancelled == 0) &&
    (kind == 1 ? o->control.failed == 1 : o->control.failed == 0);
  int finished = FinishOwner(o);
  return matched && finished && o->closed;
}
/* Actual production release helper with real acquired file/directory/process/
 * thread/job/owner/event/pipe handles. Negative cases need a separate original
 * observer of the SAME owner ledger and nonreturning invocation; no timeout or
 * process exit is a PASS. No native API/result is replaced. */
static int ProductionReleaseCase(int selected) {
  FixtureOwner* o = NewOwner(); if (!o) return 0;
  if (!OpenFixture(o,0)) { FinishOwner(o); return 0; }
  wchar_t image[32768], command[32770];
  DWORD length = GetModuleFileNameW(NULL,image,_countof(image));
  if (!length || length >= _countof(image)) RetainOriginal(o,"production-release-image");
  o->bootstrapFile = CreateFileW(image,GENERIC_READ,FILE_SHARE_READ,NULL,OPEN_EXISTING,0,NULL);
  for (unsigned i = 0; i < 2; i++) o->bootstrapDirectories[i] =
    CreateFileW(L".",GENERIC_READ,FILE_SHARE_READ|FILE_SHARE_WRITE,NULL,OPEN_EXISTING,FILE_FLAG_BACKUP_SEMANTICS,NULL);
  o->control.owner = OpenProcess(SYNCHRONIZE|PROCESS_QUERY_LIMITED_INFORMATION,FALSE,GetCurrentProcessId());
  o->control.job = CreateJobObjectW(NULL,NULL);
  o->bootstrapReader = CreateThread(NULL,0,CompletedBootstrapReader,NULL,0,NULL);
  if (o->bootstrapFile == INVALID_HANDLE_VALUE || o->bootstrapDirectories[0] == INVALID_HANDLE_VALUE ||
      o->bootstrapDirectories[1] == INVALID_HANDLE_VALUE || !o->control.owner || !o->control.job || !o->bootstrapReader)
    RetainOriginal(o,"production-release-acquisition-incomplete");
  if (_snwprintf_s(command,_countof(command),_TRUNCATE,L"\"%s\" --hold",image) < 0) RetainOriginal(o,"production-release-command");
  STARTUPINFOW startup; ZeroMemory(&startup,sizeof(startup)); startup.cb = sizeof(startup);
  if (!CreateProcessW(image,command,NULL,NULL,FALSE,CREATE_SUSPENDED,NULL,NULL,&startup,&o->bootstrapProcess))
    RetainOriginal(o,"production-release-child-create");
  if (!AssignProcessToJobObject(o->control.job,o->bootstrapProcess.hProcess)) RetainOriginal(o,"production-release-child-assign");
  if (!FinishConptyContainment(&o->control,o->bootstrapProcess.hProcess,o->bootstrapReader))
    RetainOriginal(o,"production-release-original-containment");
  HANDLE* slots[] = { &o->bootstrapReader, &o->bootstrapProcess.hThread, &o->bootstrapProcess.hProcess,
    &o->control.stopEvent, &o->control.job, &o->control.owner, &o->bootstrapFile,
    &o->bootstrapDirectories[0], &o->bootstrapDirectories[1], &o->control.pipe };
  if (selected > 0 && selected <= (int)_countof(slots)) {
    /* All acquisitions precede this close. No new handles before the release
     * helper's real CloseHandle of the saved original number. An external actor
     * can still affect reuse; record original numeric identity and real status. */
    if (!CloseHandle(*slots[selected-1])) RetainOriginal(o,"production-release-preclose-failed");
  }
  ReleaseBootstrapResources(&o->control,&o->bootstrapProcess,&o->bootstrapReader,&o->bootstrapFile,o->bootstrapDirectories,2);
  if (o->control.releaseCount != 9 || o->control.releaseFailed) RetainOriginal(o,"production-release-roster");
  /* For pipe negative, directly traverse the last production seam without a
   * new write-event acquisition that might reuse its deliberately closed value. */
  if (selected == 10) {
    ReleaseBootstrapHandle(&o->control,&o->control.pipe,"release-control-pipe",0);
    if (o->control.releaseFailed) RetainConpty();
    RetainOriginal(o,"production-pipe-release-unexpected-success");
  }
  for (unsigned i = 0; i < 64; i++) o->control.token[i] = L'a';
  if (!WriteControlLine(&o->control,"terminal",123,0)) RetainOriginal(o,"production-release-terminal-write");
  ReleaseBootstrapHandle(&o->control,&o->control.pipe,"release-control-pipe",0);
  if (o->control.releaseFailed) RetainConpty();
  if (selected) RetainOriginal(o,"production-release-unexpected-return");
  if (o->control.releaseCount != 10 || o->failures) return 0;
  for (unsigned i = 0; i < o->control.releaseCount; i++)
    if (!o->control.releases[i].attempted || !o->control.releases[i].closed || o->control.releases[i].status) return 0;
  return FinishOwner(o);
}
int wmain(int argc, wchar_t** argv) {
  if (argc == 2 && wcscmp(argv[1],L"--hold") == 0) { for (;;) Sleep(INFINITE); }
  if (argc == 2 && wcscmp(argv[1],L"--actual-write-closed-completion") == 0) return ActualWriteRetentionCase(0);
  if (argc == 2 && wcscmp(argv[1],L"--actual-write-closed-event") == 0) return ActualWriteRetentionCase(1);
  if (argc == 3 && wcscmp(argv[1],L"--production-cancel-reader") == 0) {
    int kind = _wtoi(argv[2]); if (kind < 0 || kind > 3) return 1;
    return ProductionCancelReaderCase(kind) ? 0 : 1;
  }
  if (argc == 3 && wcscmp(argv[1],L"--production-release-closed-handle") == 0) {
    int slot = _wtoi(argv[2]); if (slot < 1 || slot > 10) return 1;
    return ProductionReleaseCase(slot);
  }
  int ok = StoppedRead(0,0) && StoppedRead(1,0) && NaturalOrLostRead(0) && NaturalOrLostRead(1) && SuspendedResumeFailure(0);
  /* Independent native counterparts; no fake API, handle, completion or zero. */
  for (int point = 1; point <= 7; point++) if (!StoppedRead(1,point)) ok = 0;
  for (int point = 8; point <= 12; point++) if (!SuspendedResumeFailure(point)) ok = 0;
  if (!ActualReadError(0) || !ActualReadError(1) || !ActualDrainError() || !ActualWriteError()) ok = 0;
  if (!NaturalControlWrites()) ok = 0;
  if (!ProductionReleaseCase(0)) ok = 0;
  for (int kind = 0; kind <= 3; kind++) if (!ProductionCancelReaderCase(kind)) ok = 0;
  return ok ? 0 : 1;
}
