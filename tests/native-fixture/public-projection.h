#ifndef SERVICE_LASSO_F7_PUBLIC_H
#define SERVICE_LASSO_F7_PUBLIC_H
#include "protocol.h"
enum f7_public_status {F7_CAPTURE_UNAVAILABLE=1,F7_CAPTURE_INCOMPLETE=2,
 F7_CAPTURE_RETAINED=3,F7_CUSTODY_UNVERIFIED=4};
/* Receipt verification projection belongs to U3/U5. U1 cannot emit it. */
const char *f7_public_projection(enum f7_public_status status);
#endif
