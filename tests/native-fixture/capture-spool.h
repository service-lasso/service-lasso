#ifndef SERVICE_LASSO_F7_SPOOL_H
#define SERVICE_LASSO_F7_SPOOL_H
#include "protocol.h"
#include <sodium.h>
#ifdef _WIN32
#include <windows.h>
typedef HANDLE f7_handle;
#define F7_INVALID_HANDLE INVALID_HANDLE_VALUE
#else
typedef int f7_handle;
#define F7_INVALID_HANDLE (-1)
#endif
#ifdef __cplusplus
extern "C" {
#endif
struct f7_identity {
  uint8_t object[24], owner[68], protection_sha256[32];
  uint32_t owner_length;
};
struct f7_member {
  f7_handle handle;
  struct f7_identity identity;
  crypto_hash_sha256_state hash;
  uint64_t length;
  uint8_t digest[32];
  int finalized, failed, readback_complete;
};
/* Admitted held native objects, never named/path opening. identity is captured
   from the actual handle, not accepted from a caller JSON receipt. */
int f7_identity_read(f7_handle handle,struct f7_identity *out,int directory);
int f7_identity_equal(const struct f7_identity *a,const struct f7_identity *b);
int f7_handle_size(f7_handle handle,uint64_t *length,int64_t *native_status);
int f7_handle_readonly(f7_handle handle,int64_t *native_status);
int f7_member_adopt(struct f7_member *m,f7_handle exclusive_empty_file);
int f7_member_append(struct f7_member *m,const uint8_t *bytes,size_t count,
 uint64_t *persisted,int64_t *native_status);
int f7_member_finish(struct f7_member *m,int64_t *native_status);
int f7_member_flush(struct f7_member *m,int64_t *native_status);
int f7_member_readback(struct f7_member *m,f7_handle independent_read_handle,
 int64_t *native_status);
int f7_member_read_at(const struct f7_member *m,uint64_t offset,uint8_t *out,
 size_t count,int64_t *native_status);
/* Read-only duplicated native object handles; callers still authenticate the
   destination lifetime on the dedicated inherited role endpoint. */
int f7_member_read_capability(const struct f7_member *m,f7_handle *out);
#ifdef __cplusplus
}
#endif
#endif
