#define _GNU_SOURCE
#include "capture-spool.h"
#include <string.h>
#include <limits.h>
#ifdef _WIN32
#include <aclapi.h>
#else
#include <sys/stat.h>
#include <unistd.h>
#include <errno.h>
#include <fcntl.h>
#endif
int f7_identity_equal(const struct f7_identity *a,const struct f7_identity *b){
 return a&&b&&a->owner_length==b->owner_length&&
 !memcmp(a->object,b->object,sizeof(a->object))&&
 !memcmp(a->owner,b->owner,a->owner_length)&&
 !memcmp(a->protection_sha256,b->protection_sha256,32);
}
int f7_identity_read(f7_handle h,struct f7_identity *out,int directory){
 if(!out)return F7_INVALID;memset(out,0,sizeof(*out));
#ifdef _WIN32
 FILE_ID_INFO id;FILE_STANDARD_INFO st;FILE_ATTRIBUTE_TAG_INFO tag;
 PSID owner=NULL;PACL dacl=NULL;PSECURITY_DESCRIPTOR sd=NULL;
 SECURITY_DESCRIPTOR_CONTROL control;DWORD revision,n;
 if(!GetFileInformationByHandleEx(h,FileIdInfo,&id,sizeof(id))||
 !GetFileInformationByHandleEx(h,FileStandardInfo,&st,sizeof(st))||
 !GetFileInformationByHandleEx(h,FileAttributeTagInfo,&tag,sizeof(tag))||
 (tag.FileAttributes&FILE_ATTRIBUTE_REPARSE_POINT)||st.DeletePending||
 (directory!=!!st.Directory)||(!directory&&st.NumberOfLinks!=1))return F7_NATIVE_FAILURE;
 if(GetSecurityInfo(h,SE_FILE_OBJECT,OWNER_SECURITY_INFORMATION|DACL_SECURITY_INFORMATION,
 &owner,NULL,&dacl,NULL,&sd)!=ERROR_SUCCESS)return F7_NATIVE_FAILURE;
 if(!owner||!IsValidSid(owner)||!dacl||!GetSecurityDescriptorControl(sd,&control,&revision)||
 !(control&SE_DACL_PROTECTED)){LocalFree(sd);return F7_IDENTITY_MISMATCH;}
 n=GetLengthSid(owner);if(n>sizeof(out->owner)){LocalFree(sd);return F7_INVALID;}
 f7_u64be(out->object,id.VolumeSerialNumber);memcpy(out->object+8,id.FileId.Identifier,16);
 memcpy(out->owner,owner,n);out->owner_length=n;
 /* Exact DACL bytes plus control. Owner and object are separately bound. */
 crypto_hash_sha256_state hash;crypto_hash_sha256_init(&hash);
 crypto_hash_sha256_update(&hash,(const unsigned char *)&control,sizeof(control));
 crypto_hash_sha256_update(&hash,(const unsigned char *)dacl,dacl->AclSize);
 crypto_hash_sha256_final(&hash,out->protection_sha256);LocalFree(sd);
#else
 struct stat st;uint8_t protection[24];int flags=fcntl(h,F_GETFL);
 if(flags<0||fstat(h,&st)<0||
   (directory?!S_ISDIR(st.st_mode):!S_ISREG(st.st_mode))||
   (!directory&&st.st_nlink!=1)||(st.st_mode&0077))return F7_IDENTITY_MISMATCH;
 f7_u64be(out->object,(uint64_t)st.st_dev);f7_u64be(out->object+8,(uint64_t)st.st_ino);
 f7_u64be(out->owner,(uint64_t)st.st_uid);out->owner_length=8;
 f7_u64be(protection,(uint64_t)st.st_mode);f7_u64be(protection+8,(uint64_t)st.st_gid);
 f7_u64be(protection+16,(uint64_t)st.st_nlink);
 crypto_hash_sha256(out->protection_sha256,protection,sizeof(protection));
#endif
 return F7_OK;
}
int f7_member_adopt(struct f7_member *m,f7_handle h){
 if(!m)return F7_INVALID;memset(m,0,sizeof(*m));m->handle=F7_INVALID_HANDLE;
 if(f7_identity_read(h,&m->identity,0))return F7_IDENTITY_MISMATCH;
#ifdef _WIN32
 LARGE_INTEGER size; if(!GetFileSizeEx(h,&size)||size.QuadPart!=0)return F7_CONFLICT;
#else
 struct stat st;if(fstat(h,&st)<0||st.st_size!=0||(fcntl(h,F_GETFL)&O_ACCMODE)!=O_RDWR)return F7_CONFLICT;
#endif
 m->handle=h;crypto_hash_sha256_init(&m->hash);return F7_OK;
}
int f7_member_append(struct f7_member *m,const uint8_t *bytes,size_t count,
 uint64_t *persisted,int64_t *status){
 size_t done=0;
 if(!m||!persisted||!status||(!bytes&&count)||m->finalized||m->failed||
   count>UINT64_MAX-m->length)return F7_INVALID;
 *persisted=0;*status=0;
 while(done<count){
#ifdef _WIN32
   DWORD wrote=0,want=(DWORD)((count-done)>MAXDWORD?MAXDWORD:count-done);
   if(!WriteFile(m->handle,bytes+done,want,&wrote,NULL)||!wrote){*status=GetLastError();m->failed=1;break;}
#else
   ssize_t wrote=write(m->handle,bytes+done,count-done);
   if(wrote<0&&errno==EINTR)continue;
   if(wrote<=0){*status=wrote<0?errno:EIO;m->failed=1;break;}
#endif
   crypto_hash_sha256_update(&m->hash,bytes+done,(unsigned long long)wrote);
   done+=(size_t)wrote;m->length+=(uint64_t)wrote;
 }
 *persisted=done;return m->failed?F7_NATIVE_FAILURE:F7_OK;
}
int f7_member_finish(struct f7_member *m,int64_t *status){
 struct f7_identity current;
 if(!m||!status||m->finalized)return F7_INVALID;*status=0;
#ifdef _WIN32
 if(!FlushFileBuffers(m->handle)){*status=GetLastError();m->failed=1;}
#else
 if(fsync(m->handle)<0){*status=errno;m->failed=1;}
#endif
 if(f7_identity_read(m->handle,&current,0)||!f7_identity_equal(&current,&m->identity))m->failed=1;
 crypto_hash_sha256_final(&m->hash,m->digest);m->finalized=1;
 return m->failed?F7_INCOMPLETE:F7_OK;
}
int f7_member_read_at(const struct f7_member *m,uint64_t offset,uint8_t *out,size_t count,int64_t *status){
 size_t done=0;
 if(!m||!status||(!out&&count)||offset>INT64_MAX||count>INT64_MAX-offset)return F7_INVALID;
 *status=0;
 while(done<count){
#ifdef _WIN32
   /* independent read capability is synchronous; serialize per-capability
      position rather than depending on OVERLAPPED semantics of inherited fd. */
   LARGE_INTEGER position;DWORD got=0;position.QuadPart=(LONGLONG)(offset+done);
   if(!SetFilePointerEx(m->handle,position,NULL,FILE_BEGIN)||
      !ReadFile(m->handle,out+done,(DWORD)((count-done)>MAXDWORD?MAXDWORD:count-done),&got,NULL)||!got){
      *status=GetLastError();return F7_NATIVE_FAILURE;}
#else
   ssize_t got=pread(m->handle,out+done,count-done,(off_t)(offset+done));
   if(got<0&&errno==EINTR)continue;
   if(got<=0){*status=got<0?errno:EIO;return F7_NATIVE_FAILURE;}
#endif
   done+=(size_t)got;
 }return F7_OK;
}
int f7_member_readback(struct f7_member *m,f7_handle read_handle,int64_t *status){
 struct f7_identity id;struct f7_member reader;uint8_t buffer[65536],digest[32];
 crypto_hash_sha256_state hash;uint64_t offset=0;
 if(!m||!status||!m->finalized||m->failed)return F7_INCOMPLETE;
 if(f7_identity_read(read_handle,&id,0)||!f7_identity_equal(&m->identity,&id))return F7_IDENTITY_MISMATCH;
#ifdef _WIN32
 LARGE_INTEGER size;if(!GetFileSizeEx(read_handle,&size)||size.QuadPart<0||(uint64_t)size.QuadPart!=m->length)return F7_CONFLICT;
#else
 struct stat st;if(fstat(read_handle,&st)<0||st.st_size<0||(uint64_t)st.st_size!=m->length||
   (fcntl(read_handle,F_GETFL)&O_ACCMODE)!=O_RDONLY)return F7_CONFLICT;
#endif
 memset(&reader,0,sizeof(reader));reader.handle=read_handle;crypto_hash_sha256_init(&hash);
 while(offset<m->length){size_t n=(size_t)((m->length-offset)>sizeof(buffer)?sizeof(buffer):m->length-offset);
   if(f7_member_read_at(&reader,offset,buffer,n,status))return F7_NATIVE_FAILURE;
   crypto_hash_sha256_update(&hash,buffer,n);offset+=n;}
 crypto_hash_sha256_final(&hash,digest);
 if(sodium_memcmp(digest,m->digest,32)||f7_identity_read(read_handle,&id,0)||
   !f7_identity_equal(&m->identity,&id))return F7_CONFLICT;
 return F7_OK;
}
int f7_member_read_capability(const struct f7_member *m,f7_handle *out){
 struct f7_identity id;
 if(!m||!out||!m->finalized||m->failed)return F7_INCOMPLETE;
#ifdef _WIN32
 /* ReOpenFile refers to the SAME held file object, never a caller path. */
 *out=ReOpenFile(m->handle,GENERIC_READ|READ_CONTROL,FILE_SHARE_READ,0);
 if(*out==INVALID_HANDLE_VALUE)return F7_NATIVE_FAILURE;
#else
 /* Linux openat cannot reduce rights on an arbitrary fd without a name.
    Caller must supply separately admitted same-object read-open capability;
    duplicating O_RDWR would disclose write authority and is prohibited. */
 (void)id;*out=-1;return F7_AUTH_FAILURE;
#endif
#ifdef _WIN32
 if(f7_identity_read(*out,&id,0)||!f7_identity_equal(&id,&m->identity)){CloseHandle(*out);*out=INVALID_HANDLE_VALUE;return F7_IDENTITY_MISMATCH;}
 return F7_OK;
#endif
}
