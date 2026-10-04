#ifndef SERVICE_LASSO_F7_CRYPTO_H
#define SERVICE_LASSO_F7_CRYPTO_H
#include "capture-spool.h"
#include "attempt-journal.h"
#ifdef __cplusplus
extern "C" {
#endif
struct f7_crypto_object {
 struct f7_member *write;
 f7_handle independent_read;
 uint8_t key[16];
 int started;
 struct f7_attempt_journal *journal;
};
struct f7_signing_pin {
 uint8_t recipient[crypto_box_PUBLICKEYBYTES];
 uint8_t signer[crypto_sign_PUBLICKEYBYTES];
 /* Actual admitted key input belongs to private held initialization. Never
    argv, ENV, generated profile, compiled constant or provider credential. */
 const uint8_t *signer_secret;
};
int f7_encrypt_object_once(struct f7_crypto_object *object,const uint8_t *plain,
 size_t length,const struct f7_signing_pin *pins,int64_t *native_status);
int f7_sign_index_once(struct f7_crypto_object *signature,const uint8_t *canonical,
 size_t length,const struct f7_signing_pin *pins,int64_t *native_status);
int f7_verify_index(const uint8_t *canonical,size_t length,const uint8_t signature[64],
 const uint8_t signer[32]);
/* Domain selection is closed. No caller-selected signing context. */
enum f7_signature_domain { F7_INDEX_DOMAIN=1,F7_RECEIPT_DOMAIN=2 };
int f7_signature_message(enum f7_signature_domain domain,const uint8_t *canonical,
 size_t length,uint8_t **out,size_t *out_length);
#ifdef __cplusplus
}
#endif
#endif
