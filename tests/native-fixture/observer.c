#include "observer.h"
#include <string.h>
int f7_capture_validate(const struct f7_capture *c){
 unsigned i;
 if(!c||!c->reservation||!c->witness||c->witness->reservation!=c->reservation||
 !c->witness->member||c->witness->member->failed||c->witness->member->finalized||
 c->witness->member->handle==F7_INVALID_HANDLE||
 c->witness->role<F7_O||c->witness->role>F7_R||c->witness->failed||
 c->reservation->exhausted||c->incomplete||c->child_exit_observed||
 (c->child_created!=F7_CREATED&&c->child_created!=F7_NOT_CREATED))return F7_INVALID;
 if(c->created[F7_PRIVATE_ERRORS]!=F7_CREATED)return F7_INVALID;
 if((c->child_created==F7_CREATED&&c->original_child==F7_INVALID_HANDLE)||
   (c->child_created==F7_NOT_CREATED&&c->original_child!=F7_INVALID_HANDLE))return F7_INVALID;
 for(i=0;i<F7_STREAM_COUNT;i++){
  if(c->created[i]!=F7_CREATED&&c->created[i]!=F7_NOT_CREATED)return F7_INVALID;
  if(c->natural_eof[i]||c->observed[i]||c->terminal_status[i])return F7_CONFLICT;
  if(c->created[i]==F7_CREATED){
   if(!c->raw[i]||c->raw[i]->length||c->raw[i]->finalized||c->raw[i]->failed)return F7_CONFLICT;
  }else if(c->raw[i]||c->pipe[i]!=F7_INVALID_HANDLE)return F7_INVALID;
 }
 if(c->created[F7_PRIVATE_ERRORS]==F7_CREATED){
  if(!c->error_channel||c->error_channel->failed||c->error_channel->frames||
    c->error_channel->role!=c->witness->role||
    memcmp(c->error_channel->invocation,c->witness->invocation,16)||
    memcmp(c->error_channel->attempt,c->witness->attempt,32)||
    memcmp(c->error_channel->lifetime,c->witness->lifetime,16))return F7_AUTH_FAILURE;
 }
 return F7_OK;
}
