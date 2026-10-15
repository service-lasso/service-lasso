#include "capture-spool.h"
#ifdef _WIN32
#include <winternl.h>
typedef NTSTATUS (NTAPI *f7_query_object)(HANDLE,OBJECT_INFORMATION_CLASS,PVOID,ULONG,PULONG);
#else
#include <fcntl.h>
#include <errno.h>
#endif
int f7_handle_readonly(f7_handle handle,int64_t *native_status){
 if(!native_status||handle==F7_INVALID_HANDLE)return F7_INVALID;
 *native_status=0;
#ifdef _WIN32
 /* Query actual granted rights, rather than a claimed desired-access field.
    The exact loaded ntdll bytes/function are mandatory admission inputs. */
 HMODULE module=GetModuleHandleW(L"ntdll.dll");
 if(!module){*native_status=GetLastError();return F7_NATIVE_FAILURE;}
 f7_query_object query=(f7_query_object)GetProcAddress(module,"NtQueryObject");
 if(!query){*native_status=GetLastError();return F7_NATIVE_FAILURE;}
 PUBLIC_OBJECT_BASIC_INFORMATION information;ULONG actual=0;
 NTSTATUS status=query(handle,ObjectBasicInformation,&information,sizeof(information),&actual);
 if(status<0){*native_status=(int64_t)status;return F7_NATIVE_FAILURE;}
 if(actual<sizeof(information))return F7_INCOMPLETE;
 ACCESS_MASK prohibited=FILE_WRITE_DATA|FILE_APPEND_DATA|FILE_WRITE_EA|
  FILE_WRITE_ATTRIBUTES|DELETE|WRITE_DAC|WRITE_OWNER;
 if((information.GrantedAccess&prohibited)||
    !(information.GrantedAccess&FILE_READ_DATA))return F7_AUTH_FAILURE;
#else
 int flags=fcntl(handle,F_GETFL);
 if(flags<0){*native_status=errno;return F7_NATIVE_FAILURE;}
 if((flags&O_ACCMODE)!=O_RDONLY)return F7_AUTH_FAILURE;
#endif
 return F7_OK;
}
