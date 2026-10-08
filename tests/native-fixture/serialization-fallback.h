#ifndef SERVICE_LASSO_F7_SERIALIZATION_FALLBACK_H
#define SERVICE_LASSO_F7_SERIALIZATION_FALLBACK_H
#include "protocol.h"
#ifdef __cplusplus
extern "C" {
#endif
int f7_serialization_fallback_validate(const uint8_t *payload,size_t length);
#ifdef __cplusplus
}
#endif
#endif
