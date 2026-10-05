#pragma once
#include "authentication.hpp"
#include <exception>
#ifndef _WIN32
#include <sys/vfs.h>
#include <sys/ioctl.h>
#include <linux/nsfs.h>
#include <linux/magic.h>
#include <sched.h>
#endif

namespace slcore {
// These are actual API bodies, not a profile, capability or qualification
// attestation. Every borrower must retain the owning custody object.
struct OriginalClockNativeObservation {
  char operation[32]{};
  std::int64_t result=0;
  std::uint64_t error=0,process=0,thread=0;
  std::size_t size=0;
  std::array<std::uint8_t,8192> body{};
};
class OriginalClockThreadCustody {
  Budget owner_;
  // PARTIAL SOURCE LIMIT: retain originals without overwrite. This fixed
  // authoring prototype is not the whole full64MiB retained-history solution.
  std::array<OriginalClockNativeObservation,256> observations_{};
  std::size_t count_=0;
  std::uint64_t processId_=0,threadId_=0,lastTick_=0;
  bool acquired_=false,failed_=false,closed_=false,closeUnknown_=false;
  std::exception_ptr originalFailure_;
  std::array<bool,6> closeResults_{};
  Handle process_,thread_;
#ifdef _WIN32
  FILETIME processBirth_{},threadBirth_{};
  LARGE_INTEGER frequency_{};
#else
  Handle proc_,processDirectory_,taskDirectory_,namespace_;
  struct stat procIdentity_{},processIdentity_{},taskIdentity_{},namespaceIdentity_{};
  std::uint64_t processBirth_=0,taskBirth_=0;
#endif
  explicit OriginalClockThreadCustody(Budget owner):owner_(std::move(owner)){}
  OriginalClockNativeObservation& record(const char* operation,std::int64_t result,
      std::uint64_t error,const void* body=nullptr,std::size_t size=0){
    if(count_==observations_.size()||size>observations_[0].body.size()){
      failed_=true;throw Denied(9);
    }
    auto& row=observations_[count_++];const auto length=std::strlen(operation);
    if(length>=sizeof(row.operation)){failed_=true;throw Denied(9);}
    std::memcpy(row.operation,operation,length);row.result=result;row.error=error;
    row.process=processId_;row.thread=threadId_;row.size=size;
    if(size)std::memcpy(row.body.data(),body,size);return row;
  }
  void require(bool condition){if(!condition){failed_=true;throw Denied(9);}}
#ifdef _WIN32
  static bool sameBirth(const FILETIME& a,const FILETIME& b){
    return a.dwHighDateTime==b.dwHighDateTime&&a.dwLowDateTime==b.dwLowDateTime;
  }
  Handle duplicate(HANDLE original,const char* operation){
    HANDLE retained=nullptr;const auto ok=DuplicateHandle(GetCurrentProcess(),original,
        GetCurrentProcess(),&retained,0,FALSE,DUPLICATE_SAME_ACCESS);
    const auto error=ok?0:GetLastError();record(operation,ok,error,&retained,sizeof(retained));
    require(ok&&retained&&retained!=INVALID_HANDLE_VALUE);return Handle(retained);
  }
  FILETIME birth(const Handle& handle,bool thread){
    std::array<FILETIME,4> body{};
    const auto ok=thread?GetThreadTimes(handle.get(),&body[0],&body[1],&body[2],&body[3]):
        GetProcessTimes(handle.get(),&body[0],&body[1],&body[2],&body[3]);
    const auto error=ok?0:GetLastError();record(thread?"GetThreadTimes":"GetProcessTimes",ok,error,body.data(),sizeof(body));
    require(ok);return body[0];
  }
  void alive(const Handle& handle,const char* operation){
    const auto code=WaitForSingleObject(handle.get(),0);
    const auto error=code==WAIT_FAILED?GetLastError():0;record(operation,code,error);
    require(code==WAIT_TIMEOUT);
  }
  void acquire(){
    processId_=GetCurrentProcessId();threadId_=GetCurrentThreadId();
    record("current native IDs",0,0);require(processId_&&threadId_);
    process_=duplicate(GetCurrentProcess(),"retain current process");
    thread_=duplicate(GetCurrentThread(),"retain current thread");
    processBirth_=birth(process_,false);threadBirth_=birth(thread_,true);
    const auto ok=QueryPerformanceFrequency(&frequency_);const auto error=ok?0:GetLastError();
    record("QueryPerformanceFrequency",ok,error,&frequency_,sizeof(frequency_));
    require(ok&&frequency_.QuadPart>0);acquired_=true;checkCurrent();
  }
  void checkCurrent(){
    require(GetCurrentProcessId()==processId_&&GetCurrentThreadId()==threadId_);
    const auto pid=GetProcessId(process_.get()),tid=GetThreadId(thread_.get());
    const auto parent=GetProcessIdOfThread(thread_.get());
    const std::array<DWORD,3> ids{pid,tid,parent};record("held process/thread IDs",0,0,ids.data(),sizeof(ids));
    require(pid==processId_&&tid==threadId_&&parent==processId_);
    alive(process_,"Wait original process");alive(thread_,"Wait original thread");
    require(sameBirth(processBirth_,birth(process_,false))&&sameBirth(threadBirth_,birth(thread_,true)));
  }
#else
  static bool sameObject(const struct stat& a,const struct stat& b){
    return a.st_dev==b.st_dev&&a.st_ino==b.st_ino&&a.st_mode==b.st_mode&&a.st_uid==b.st_uid;
  }
  Handle openNative(int parent,const char* path,int flags,const char* operation){
    const auto fd=parent<0 ? ::open(path,flags) : ::openat(parent,path,flags);
    const auto error=fd<0?errno:0;record(operation,fd,error);require(fd>=0);return Handle(fd);
  }
  struct stat statNative(const Handle& handle,const char* operation){
    struct stat body{};const auto code=fstat(handle.get(),&body);const auto error=code?errno:0;
    record(operation,code,error,&body,sizeof(body));require(code==0);return body;
  }
  void checkProc(const Handle& handle){
    struct statfs body{};const auto code=fstatfs(handle.get(),&body);const auto error=code?errno:0;
    record("fstatfs original proc",code,error,&body,sizeof(body));require(code==0&&body.f_type==PROC_SUPER_MAGIC);
  }
  struct stat namespaceBody(const Handle& handle){
    const auto body=statNative(handle,"fstat held time namespace");
    const auto type=ioctl(handle.get(),NS_GET_NSTYPE);const auto error=type<0?errno:0;
    record("NS_GET_NSTYPE",type,error,&type,sizeof(type));
    require(type==CLONE_NEWTIME);return body;
  }
  std::uint64_t birth(const Handle& directory,const char* operation){
    auto file=openNative(directory.get(),"stat",O_RDONLY|O_CLOEXEC|O_NOFOLLOW,operation);
    std::array<char,8192> body{};std::size_t size=0;
    for(;;){
      require(size<body.size());const auto count=::read(file.get(),body.data()+size,body.size()-size);
      const auto error=count<0?errno:0;
      if(count<0){record("read held original stat",count,error);if(error==EINTR)continue;require(false);}
      record("read held original stat",count,0,body.data()+size,static_cast<std::size_t>(count));
      if(count==0)break;size+=static_cast<std::size_t>(count);
    }
    const auto close=file.close();record("close stat reader",close,0);require(close);
    // No path reread, stream allocation or requested PID. Field22 is decoded
    // from this bounded original held body; comm may contain spaces or ')'.
    std::size_t end=size;while(end&&body[end-1]!=')')--end;require(end&&end+1<size&&body[end]==' ');
    std::size_t offset=end+1;
    for(unsigned field=3;field<=22;++field){
      while(offset<size&&body[offset]==' ')++offset;const auto begin=offset;
      while(offset<size&&body[offset]!=' '&&body[offset]!='\n')++offset;require(offset>begin);
      if(field==22){std::uint64_t value=0;for(auto i=begin;i<offset;++i){
        require(body[i]>='0'&&body[i]<='9');const auto digit=static_cast<unsigned>(body[i]-'0');
        require(value<=(UINT64_MAX-digit)/10);value=value*10+digit;
      }require(value!=0);return value;}
    }
    require(false);return 0;
  }
  void alive(){
    pollfd body{process_.get(),POLLIN,0};const auto code=poll(&body,1,0);const auto error=code<0?errno:0;
    record("poll original pidfd",code,error,&body,sizeof(body));require(code==0&&body.revents==0);
  }
  void acquire(){
    const auto pid=getpid(),tid=syscall(SYS_gettid);require(pid>0&&tid>0);
    processId_=pid;threadId_=tid;record("getpid/gettid",0,0);
    const auto fd=static_cast<int>(syscall(SYS_pidfd_open,pid,0));const auto error=fd<0?errno:0;
    record("pidfd_open original",fd,error);require(fd>=0);process_=Handle(fd);alive();
    proc_=openNative(-1,"/proc",O_RDONLY|O_CLOEXEC|O_DIRECTORY|O_NOFOLLOW,"open original procfs");
    checkProc(proc_);procIdentity_=statNative(proc_,"fstat original procfs");
    const auto pidText=std::to_string(processId_);
    processDirectory_=openNative(proc_.get(),pidText.c_str(),O_RDONLY|O_CLOEXEC|O_DIRECTORY|O_NOFOLLOW,"open original process dir");
    checkProc(processDirectory_);processIdentity_=statNative(processDirectory_,"fstat original process dir");
    processBirth_=birth(processDirectory_,"open original process stat");
    auto tasks=openNative(processDirectory_.get(),"task",O_RDONLY|O_CLOEXEC|O_DIRECTORY|O_NOFOLLOW,"open original task root");
    const auto tidText=std::to_string(threadId_);
    taskDirectory_=openNative(tasks.get(),tidText.c_str(),O_RDONLY|O_CLOEXEC|O_DIRECTORY|O_NOFOLLOW,"open original task dir");
    taskIdentity_=statNative(taskDirectory_,"fstat original task dir");checkProc(taskDirectory_);
    taskBirth_=birth(taskDirectory_,"open original task stat");
    const auto ended=tasks.close();record("close task root reader",ended,0);require(ended);
    namespace_=openNative(taskDirectory_.get(),"ns/time",O_RDONLY|O_CLOEXEC,"open original time ns");
    namespaceIdentity_=namespaceBody(namespace_);acquired_=true;checkCurrent();
  }
  void checkCurrent(){
    require(static_cast<std::uint64_t>(getpid())==processId_&&static_cast<std::uint64_t>(syscall(SYS_gettid))==threadId_);
    alive();require(sameObject(procIdentity_,statNative(proc_,"recheck original procfs")));
    require(sameObject(processIdentity_,statNative(processDirectory_,"recheck original process dir")));
    require(sameObject(taskIdentity_,statNative(taskDirectory_,"recheck original task dir")));
    require(processBirth_==birth(processDirectory_,"open process birth recheck")&&taskBirth_==birth(taskDirectory_,"open task birth recheck"));
    auto current=openNative(taskDirectory_.get(),"ns/time",O_RDONLY|O_CLOEXEC,"open current task time ns");
    require(sameObject(namespaceIdentity_,namespaceBody(namespace_))&&sameObject(namespaceIdentity_,namespaceBody(current)));
    const auto ended=current.close();record("close namespace reader",ended,0);require(ended);alive();
  }
#endif
public:
  OriginalClockThreadCustody(const OriginalClockThreadCustody&)=delete;
  OriginalClockThreadCustody& operator=(const OriginalClockThreadCustody&)=delete;
  // Acquisition failures return the actual failed object, including native
  // observations and held originals. Owner must retain it; failure is not FREE.
  static std::shared_ptr<OriginalClockThreadCustody> retainOriginalSamplingThread(Budget& owner,Deadline& originalAcquisition){
    owner.reserve(sizeof(OriginalClockThreadCustody));
    OriginalClockThreadCustody* value=nullptr;
    try{value=new OriginalClockThreadCustody(owner);}catch(...){owner.closed(sizeof(OriginalClockThreadCustody));throw;}
    std::shared_ptr<OriginalClockThreadCustody> retained(value);
    try{originalAcquisition.check();value->acquire();originalAcquisition.check();}
    catch(...){value->failed_=true;value->originalFailure_=std::current_exception();}
    return retained;
  }
  bool acquired()const noexcept{return acquired_&&!failed_&&!closed_&&!closeUnknown_;}
  bool failed()const noexcept{return failed_;}
  bool closureUnresolved()const noexcept{return closeUnknown_;}
  const std::exception_ptr& originalFailure()const noexcept{return originalFailure_;}
  const std::array<bool,6>& nativeCloseResults()const noexcept{return closeResults_;}
  bool sameOriginalOwner(const Budget& owner)const noexcept{return owner_.sameOriginalOwner(owner);}
  std::uint64_t originalProcess()const noexcept{return processId_;}
  std::uint64_t originalThread()const noexcept{return threadId_;}
  std::size_t observationCount()const noexcept{return count_;}
  const OriginalClockNativeObservation& observation(std::size_t index)const{if(index>=count_)throw Denied(9);return observations_[index];}
  void checkOriginalSamplingThread(){require(acquired());try{checkCurrent();}catch(...){failed_=true;if(!originalFailure_)originalFailure_=std::current_exception();throw;}}
  OriginalClockSample sampleOriginal(){
    try{
    checkOriginalSamplingThread();OriginalClockSample sample{};
#ifdef _WIN32
    LARGE_INTEGER frequency{},counter{};const auto frequencyOk=QueryPerformanceFrequency(&frequency);
    const auto frequencyError=frequencyOk?0:GetLastError();record("QueryPerformanceFrequency",frequencyOk,frequencyError,&frequency,sizeof(frequency));
    require(frequencyOk&&frequency.QuadPart==frequency_.QuadPart);
    const auto counterOk=QueryPerformanceCounter(&counter);const auto counterError=counterOk?0:GetLastError();
    record("QueryPerformanceCounter",counterOk,counterError,&counter,sizeof(counter));require(counterOk&&counter.QuadPart>=0);
    sample.tick=static_cast<std::uint64_t>(counter.QuadPart);sample.frequency=static_cast<std::uint64_t>(frequency.QuadPart);
#else
    timespec counter{};const auto code=clock_gettime(CLOCK_MONOTONIC,&counter);const auto error=code?errno:0;
    record("clock_gettime monotonic",code,error,&counter,sizeof(counter));require(code==0&&counter.tv_sec>=0&&counter.tv_nsec>=0&&counter.tv_nsec<1000000000L);
    const auto seconds=static_cast<std::uint64_t>(counter.tv_sec),nanos=static_cast<std::uint64_t>(counter.tv_nsec);
    require(seconds<=(UINT64_MAX-nanos)/1000000000ULL);sample.tick=seconds*1000000000ULL+nanos;sample.frequency=1000000000ULL;
#endif
    sample.process=processId_;sample.thread=threadId_;checkOriginalSamplingThread();
    require(sample.tick>=lastTick_);lastTick_=sample.tick;return sample;
    }catch(...){failed_=true;if(!originalFailure_)originalFailure_=std::current_exception();throw;}
  }
  // Explicit positive native close only. Evidence stays borrowed/charged until
  // owner retirement; no GC/finalizer or logical counter implies physical FREE.
  bool closeNativeCustody()noexcept{
    if(closeUnknown_)return false;if(closed_)return true;bool ended=true;
    closeResults_[0]=thread_.close();ended=closeResults_[0]&&ended;
    closeResults_[1]=process_.close();ended=closeResults_[1]&&ended;
#ifndef _WIN32
    closeResults_[2]=namespace_.close();ended=closeResults_[2]&&ended;
    closeResults_[3]=taskDirectory_.close();ended=closeResults_[3]&&ended;
    closeResults_[4]=processDirectory_.close();ended=closeResults_[4]&&ended;
    closeResults_[5]=proc_.close();ended=closeResults_[5]&&ended;
#endif
    if(!ended){closeUnknown_=true;failed_=true;return false;}closed_=true;return true;
  }
};
}
