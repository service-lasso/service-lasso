#include "public-projection.h"
const char *f7_public_projection(enum f7_public_status status){
 switch(status){
 case F7_CAPTURE_UNAVAILABLE:return "{\"status\":\"capture_unavailable\"}";
 case F7_CAPTURE_INCOMPLETE:return "{\"status\":\"capture_incomplete\"}";
 case F7_CAPTURE_RETAINED:return "{\"status\":\"capture_retained\"}";
 case F7_CUSTODY_UNVERIFIED:return "{\"status\":\"custody_unverified\"}";
 default:return "{\"status\":\"capture_unavailable\"}";
 }
}
