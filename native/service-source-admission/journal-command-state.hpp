#pragma once
#include "command.hpp"
#include "journal-storage.hpp"
#include "key-resolution.hpp"

namespace slcore {
// Signed metadata selection only. The full selected value owns the row;
// this carrier cannot issue a stage read handle or a native proof receipt.
class OriginalStageJournalSelection {
  OriginalNativeJournal original_;
  std::size_t row_;
  friend class NativeJournalCommandState;
  OriginalStageJournalSelection(OriginalNativeJournal original,std::size_t row)
      :original_(std::move(original)),row_(row){}
public:
  OriginalStageJournalSelection(const OriginalStageJournalSelection&)=delete;
  OriginalStageJournalSelection& operator=(const OriginalStageJournalSelection&)=delete;
  OriginalStageJournalSelection(OriginalStageJournalSelection&&)=default;
  OriginalStageJournalSelection& operator=(OriginalStageJournalSelection&&)=delete;
  const Json& originalRow()const{return journalRows(original_.payload.at("stages"),4096).at(row_);}
  const OriginalNativeJournal& originalJournal()const noexcept{return original_;}
};
// Resource arguments are original admitted native objects supplied by the
// complete engine constructor. This state neither resolves ROOT authority nor
// exposes a JS projection callback. Mutation/observer/control states are still
// separate required engine implementations.
class NativeJournalCommandState {
  std::shared_ptr<NativeJournalStore> originalStore_;
  const NativeJournalIdentity originalIdentity_;
  const Endpoint originalProvider_;
  const std::string originalVersion_;
  Budget originalOwner_;
  bool opened_=false,unresolved_=false;
  std::unique_ptr<NativeKeyResolutionLedger> originalKeyResolutions_;
  OriginalNativeJournal selected(Deadline& deadline){
    if(unresolved_)throw Denied(9);
    try{
      auto selectorProvider=connectOriginalEndpoint(originalProvider_,ChannelDomain::KeyProvider,originalOwner_,deadline);
      auto journalProvider=connectOriginalEndpoint(originalProvider_,ChannelDomain::KeyProvider,originalOwner_,deadline);
      auto observed=originalStore_->readSelected(originalVersion_,*selectorProvider,*journalProvider,originalOwner_,deadline);
      deadline.check();return observed;
    }catch(...){unresolved_=true;throw;}
  }
  std::unique_ptr<NativeOwnedBuffer> response(const NativeCommand& command,const Writer& encoded){
    if(encoded.bytes().size()>resultCap(command.operation))throw Denied(4);
    auto original=std::make_unique<NativeOwnedBuffer>(encoded.bytes().size(),originalOwner_);
    std::copy(encoded.bytes().begin(),encoded.bytes().end(),original->bytes().begin());return original;
  }
public:
  NativeJournalCommandState(std::shared_ptr<NativeJournalStore> store,NativeJournalIdentity identity,
      Endpoint provider,std::string retainedVersion,Budget owner)
      :originalStore_(std::move(store)),originalIdentity_(std::move(identity)),originalProvider_(std::move(provider)),
       originalVersion_(std::move(retainedVersion)),originalOwner_(std::move(owner)){
    if(!originalStore_||!nativeSafeIdentity(originalVersion_,1,64)||!lowerDigest(originalIdentity_.profileDigest)||
       !lowerDigest(originalIdentity_.workspaceIdentityDigest)||!nativeSafeIdentity(originalIdentity_.providerId,1,128)||
       !nativeSafeIdentity(originalIdentity_.keySetId,1,128))throw Denied(2);
    originalOwner_.reserve(sizeof(NativeKeyResolutionLedger));
    originalKeyResolutions_=std::make_unique<NativeKeyResolutionLedger>();
  }
  NativeJournalCommandState(const NativeJournalCommandState&)=delete;
  NativeJournalCommandState& operator=(const NativeJournalCommandState&)=delete;
  bool originalUnresolved()const noexcept{return unresolved_;}
  OriginalStageJournalSelection selectOriginalStage(const NativeCommand& command,Deadline& deadline){
    if(command.operation!=Operation::LookupStage||!opened_||unresolved_)throw Denied(3);
    if(command.provider!=originalIdentity_.providerId||
       hex(command.workspace)!=originalIdentity_.workspaceIdentityDigest)throw Denied(11);
    auto original=selected(deadline);
    const auto& rows=journalRows(original.payload.at("stages"),4096);
    std::size_t found=rows.size();
    for(std::size_t index=0;index<rows.size();++index){
      const auto& row=rows[index];
      if(row.at("id").scalar!=command.reference)continue;
      if(row.at("actorId").scalar!=command.actor||
         row.at("providerId").scalar!=command.provider||
         row.at("workspaceIdentityDigest").scalar!=hex(command.workspace))throw Denied(11);
      if(found!=rows.size())throw Denied(5);
      found=index;
    }
    if(found==rows.size())throw Denied(11);
    deadline.check();return OriginalStageJournalSelection(std::move(original),found);
  }
  std::unique_ptr<NativeOwnedBuffer> resolveKey(const NativeCommand& command,Bytes& originalRequest,Deadline& deadline){
    if(command.operation!=Operation::ResolveKey||!opened_||unresolved_||!originalKeyResolutions_)throw Denied(3);
    if(command.originalRawKeyOffset>originalRequest.size()||
       command.rawKey.count>originalRequest.size()-command.originalRawKeyOffset||
       command.rawKey.bytes!=originalRequest.data()+command.originalRawKeyOffset)throw Denied(5);
    struct OriginalSecretRetirement {
      std::uint8_t* original;std::size_t count;
      void clear()noexcept{wipe(original,count);}
      ~OriginalSecretRetirement(){clear();}
    } secret{originalRequest.data()+command.originalRawKeyOffset,command.rawKey.count};
    if(command.provider!=originalIdentity_.providerId||hex(command.workspace)!=originalIdentity_.workspaceIdentityDigest)throw Denied(11);
    if(!deadline.hasOriginalClock())throw Denied(9);
    try{
      auto original=selected(deadline);
      const auto& versions=journalRows(original.payload.at("keyVersions"),64);
      using DerivedVersions=std::array<NativeDerivedVersion,64>;
      originalOwner_.reserve(sizeof(DerivedVersions));
      auto derived=std::make_unique<DerivedVersions>();std::uint8_t count=0;
      // Storage ends locally; its control/allocator retirement still belongs
      // to the complete physical owner. Do not emit a fabricated FREE row.
      struct DerivedRetirement {DerivedVersions& bytes;~DerivedRetirement(){wipe(bytes.data(),sizeof(bytes));}} retirement{*derived};
      const Json* currentVersion=nullptr;
      // Exact fixed preimage only. No additional provider/workspace strings,
      // raw-key std::string, normalization or secret capture is introduced.
      {
      Writer preimage(392,originalOwner_);preimage.string(command.actor,256,1);
      preimage.u32(command.rawKey.count);preimage.raw(command.rawKey.bytes,command.rawKey.count);
      for(const auto& version:versions){
        if(version.at("state").scalar=="current"){if(currentVersion)throw Denied(5);currentVersion=&version;}
        deadline.check();auto provider=connectOriginalEndpoint(originalProvider_,ChannelDomain::KeyProvider,originalOwner_,deadline);
        const auto mac=requestProviderSignature(*provider,KeyDomain::Idempotency,version.at("version").scalar,
          preimage.bytes(),originalOwner_,deadline);
        if(count>=derived->size())throw Denied(5);(*derived)[count++].assign(version.at("version").scalar,mac);
      }
      }
      // All actual provider derivations have ended. Neither retained journal
      // lookup nor response encoding needs the original request's raw secret.
      // Wiping is not a buffer/IO/control retirement or capacity release.
      secret.clear();
      if(!count||!currentVersion)throw Denied(5);
      const Json* mapped=nullptr;
      for(const auto& candidate:journalRows(original.payload.at("keyMappings"),4096)){
        if(candidate.at("actorId").scalar!=command.actor||candidate.at("providerId").scalar!=command.provider||
           candidate.at("workspaceIdentityDigest").scalar!=hex(command.workspace))continue;
        bool match=false;
        for(std::uint8_t index=0;index<count;++index)if((*derived)[index].matches(candidate.at("keyVersion").scalar)&&
          equal((*derived)[index].mac,unhex(journalDigest(candidate.at("keyHMAC")))))match=true;
        if(!match)continue;
        // Validation of the selected full journal already joins each mapping
        // to its original retained preflight/BINDING/operation. Current client
        // is not another idempotency partition and never replaces lineage.
        if(candidate.at("preflightId").scalar!=command.reference)throw Denied(15);
        if(mapped&&mapped->at("operationId").scalar!=candidate.at("operationId").scalar)throw Denied(5);
        mapped=&candidate;
      }
      Writer encoded(resultCap(Operation::ResolveKey),originalOwner_);
      encoded.u8(static_cast<std::uint8_t>(Operation::ResolveKey)+128);encoded.u32(command.sequence);encoded.u8(0);
      if(mapped){
        const Json* operation=nullptr;
        for(const auto& candidate:journalRows(original.payload.at("operations"),4096))
          if(candidate.at("projection").at("id").scalar==mapped->at("operationId").scalar){if(operation)throw Denied(5);operation=&candidate;}
        if(!operation||operation->at("actorId").scalar!=command.actor||
           operation->at("providerId").scalar!=command.provider||
           operation->at("workspaceIdentityDigest").scalar!=hex(command.workspace))throw Denied(5);
        const auto& projection=operation->at("projection");journalProjection(projection);
        encoded.u8(projection.at("status").scalar=="accepted"?1:2);
        const auto bytes=canonical(projection,8192);encoded.u32(static_cast<std::uint32_t>(bytes.size()));encoded.raw(bytes.data(),bytes.size());
        encoded.u64(original.generation);
      }else{
        auto& slot=originalKeyResolutions_->vacant();
        slot.assign(command,unhex(originalIdentity_.profileDigest),hash(canonical(original.payload.at("keyVersions"),16384)),
          original.generation,*derived,count,deadline);
        originalKeyResolutions_->checkOriginalUnique(slot);
        // A MISS is a private bounded capability, never a durable key claim.
        encoded.u8(0);encoded.digest(slot.handle);encoded.string(currentVersion->at("version").scalar,64,1);encoded.u64(original.generation);
      }
      auto result=response(command,encoded);deadline.check();return result;
    }catch(const Denied& failed){
      if(failed.code==15)throw;
      unresolved_=true;originalKeyResolutions_->invalidate();throw;
    }catch(...){unresolved_=true;originalKeyResolutions_->invalidate();throw;}
  }
  std::unique_ptr<NativeOwnedBuffer> open(const NativeCommand& command,Deadline& deadline){
    if(command.operation!=Operation::Open||command.sequence!=0||opened_||unresolved_)throw Denied(3);
    if(hex(command.profile)!=originalIdentity_.profileDigest||hex(command.workspace)!=originalIdentity_.workspaceIdentityDigest)throw Denied(2);
    auto original=selected(deadline);
    // Current version is confirmed from the complete selected journal, not
    // inferred from an endpoint name or an arbitrary retained-key candidate.
    bool current=false;for(const auto& version:journalRows(original.payload.at("keyVersions"),64))
      if(version.at("version").scalar==originalVersion_&&version.at("state").scalar=="current")current=true;
    if(!current)throw Denied(2);
    Writer encoded(resultCap(Operation::Open),originalOwner_);
    encoded.u8(static_cast<std::uint8_t>(Operation::Open)+128);encoded.u32(command.sequence);encoded.u8(0);
    encoded.u64(original.generation);encoded.string(originalVersion_,64,1);
    auto result=response(command,encoded);deadline.check();opened_=true;return result;
  }
  // Native engine-only full transition publication. No projection callback,
  // requested root, caller-owned generation or durable:true flag is accepted.
  OriginalNativeJournal publishOriginalTransition(const OriginalNativeJournal& prior,
      const Json& completeNext,Deadline& deadline){
    if(!opened_||unresolved_)throw Denied(9);
    try{
      deadline.check();validateNativeJournalPayload(prior.payload,originalIdentity_);
      validateNativeJournalPayload(completeNext,originalIdentity_);
      if(!equal(hash(canonical(prior.payload,16777216)),prior.payloadSha)||
         prior.generation!=journalDecimal(prior.payload.at("generation"))||
         prior.generation==UINT64_MAX||journalDecimal(completeNext.at("generation"))!=prior.generation+1||
         completeNext.at("previousPayloadSha256").isNull()||
         journalDigest(completeNext.at("previousPayloadSha256"))!=hex(prior.payloadSha))throw Denied(5);
      auto original=originalStore_->publishNext(prior,completeNext,originalProvider_,originalVersion_,originalOwner_,deadline);
      deadline.check();
      if(original.generation!=prior.generation+1||
         !equal(original.payloadSha,hash(canonical(completeNext,16777216))))throw Denied(9);
      return original;
    }catch(...){unresolved_=true;throw;}
  }
  std::unique_ptr<NativeOwnedBuffer> readOperation(const NativeCommand& command,Deadline& deadline){
    if(command.operation!=Operation::ReadOperation||!opened_||unresolved_)throw Denied(3);
    auto original=selected(deadline);const Json* matching=nullptr;
    for(const auto& operation:journalRows(original.payload.at("operations"),4096)){
      if(operation.at("projection").at("id").scalar!=command.operationId)continue;
      if(operation.at("actorId").scalar!=command.actor)throw Denied(11);
      if(matching)throw Denied(5);matching=&operation.at("projection");
    }
    if(!matching)throw Denied(11);journalProjection(*matching);const auto projection=canonical(*matching,8192);
    Writer encoded(resultCap(Operation::ReadOperation),originalOwner_);
    encoded.u8(static_cast<std::uint8_t>(Operation::ReadOperation)+128);encoded.u32(command.sequence);encoded.u8(0);
    encoded.u32(static_cast<std::uint32_t>(projection.size()));encoded.raw(projection.data(),projection.size());
    auto result=response(command,encoded);deadline.check();return result;
  }
  std::unique_ptr<NativeOwnedBuffer> lookupPreflight(const NativeCommand& command,Deadline& deadline){
    if(command.operation!=Operation::LookupPreflight||!opened_||unresolved_)throw Denied(3);
    if(command.provider!=originalIdentity_.providerId||hex(command.workspace)!=originalIdentity_.workspaceIdentityDigest)throw Denied(11);
    auto original=selected(deadline);const Json* matching=nullptr;
    for(const auto& row:journalRows(original.payload.at("preflights"),4096)){
      if(row.at("id").scalar!=command.reference)continue;
      if(row.at("actorId").scalar!=command.actor||
         row.at("providerId").scalar!=command.provider||row.at("workspaceIdentityDigest").scalar!=hex(command.workspace))throw Denied(11);
      if(matching)throw Denied(5);matching=&row;
    }
    if(!matching)throw Denied(11);
    const auto& row=*matching;const Json* operation=nullptr;
    if(!row.at("consumedBy").isNull()){
      for(const auto& candidate:journalRows(original.payload.at("operations"),4096)){
        if(candidate.at("projection").at("id").scalar!=row.at("consumedBy").scalar)continue;
        if(operation||candidate.at("preflightId").scalar!=row.at("id").scalar||
           candidate.at("actorId").scalar!=command.actor||candidate.at("clientId").scalar!=row.at("clientId").scalar||
           candidate.at("providerId").scalar!=command.provider||candidate.at("workspaceIdentityDigest").scalar!=hex(command.workspace))throw Denied(5);
        operation=&candidate.at("projection");
      }
      if(!operation)throw Denied(5);
    }
    Writer encoded(resultCap(Operation::LookupPreflight),originalOwner_);
    encoded.u8(static_cast<std::uint8_t>(Operation::LookupPreflight)+128);encoded.u32(command.sequence);encoded.u8(0);
    for(auto key:{"id","stageId"})encoded.string(row.at(key).scalar,36,36);
    for(auto key:{"actorId","clientId"})encoded.string(row.at(key).scalar,256,1);
    encoded.string(row.at("confirmationId").scalar,36,36);
    encoded.u64(journalDecimal(row.at("expiresAt")));encoded.u64(journalDecimal(row.at("confirmationExpiresAt")));
    const auto& binding=row.at("binding");journalBinding(binding);
    encoded.string(binding.at("templateId").scalar,128,1);encoded.string(binding.at("templateCommit").scalar,40,40);
    encoded.string(binding.at("templateVersion").scalar,64,1);encoded.digest(unhex(journalDigest(binding.at("contractDigest"))));
    encoded.string(binding.at("serviceId").scalar,63,1);encoded.string(binding.at("version").scalar,64,1);
    for(auto key:{"archiveSha256","stagedDigest","manifestSha256","materializationDigest","admissionFingerprint"})encoded.digest(unhex(journalDigest(binding.at(key))));
    encoded.u32(static_cast<std::uint32_t>(binding.at("inventoryCount").uintValue(128)));
    encoded.u64(binding.at("expandedBytes").uintValue(67108864));
    encoded.digest(unhex(journalDigest(row.at("bindingDigest"))));encoded.digest(unhex(journalDigest(row.at("declarationDigest"))));
    encoded.digest(unhex(journalDigest(row.at("stageReadReceiptRef").at("digest"))));
    encoded.u8(operation?1:0);encoded.u8(operation?1:0);
    if(operation){
      encoded.string(row.at("consumedBy").scalar,36,36);journalProjection(*operation);
      const auto projection=canonical(*operation,8192);encoded.u32(static_cast<std::uint32_t>(projection.size()));encoded.raw(projection.data(),projection.size());
    }
    encoded.u64(original.generation);auto result=response(command,encoded);deadline.check();return result;
  }
  std::unique_ptr<NativeOwnedBuffer> preacceptIntent(const NativeCommand& command,Deadline& deadline){
    if(command.operation!=Operation::PreacceptIntent||!opened_||unresolved_)throw Denied(3);
    auto original=selected(deadline);const Json* preflight=nullptr;const Json* capsule=nullptr;const Json* stage=nullptr;
    for(const auto& row:journalRows(original.payload.at("preflights"),4096))if(row.at("id").scalar==command.preflight){if(preflight)throw Denied(5);preflight=&row;}
    if(!preflight)throw Denied(11);if(!preflight->at("consumedBy").isNull())throw Denied(14);
    for(const auto& row:journalRows(original.payload.at("stages"),4096))if(row.at("id").scalar==preflight->at("stageId").scalar){if(stage)throw Denied(5);stage=&row;}
    for(const auto& row:journalRows(original.payload.at("capsules"),4096))if(row.at("id").scalar==command.capsule){if(capsule)throw Denied(5);capsule=&row;}
    if(!stage||!capsule||capsule->at("state").scalar!="sealed"||capsule->at("catalogDigest").scalar!=stage->at("catalogDigest").scalar)throw Denied(5);
    NativeOwnedBuffer payload(command.payload.count,originalOwner_);std::copy_n(command.payload.bytes,command.payload.count,payload.bytes().begin());
    const auto audit=parseNativeAdmissionAudit(payload.bytes());const auto& binding=preflight->at("binding");
    if(audit.at("action").scalar!="source_admission_premutation"||!audit.at("operationId").isNull()||
       audit.at("outcome").scalar!="allowed"||audit.at("replayed").boolean||!audit.at("errorCode").isNull())throw Denied(10);
    for(auto key:{"actorId","clientId"})if(!journalEqual(audit.at(key),preflight->at(key)))throw Denied(10);
    if(audit.at("stageId").scalar!=preflight->at("stageId").scalar||audit.at("preflightId").scalar!=command.preflight)throw Denied(10);
    for(auto key:{"templateId","templateCommit","templateVersion","contractDigest"})if(!journalEqual(audit.at("template").at(key),binding.at(key)))throw Denied(10);
    for(auto key:{"serviceId","admissionFingerprint","stagedDigest","materializationDigest","inventoryCount"})if(!journalEqual(audit.at(key),binding.at(key)))throw Denied(10);
    const std::string canonicalPayload(payload.bytes().begin(),payload.bytes().end());const auto payloadSha=hex(hash(payload.bytes()));
    bool existing=false;
    for(const auto& row:journalRows(original.payload.at("outbox"),8192))if(row.at("eventId").scalar==command.event){
      if(existing||row.at("phase").scalar!="premutation"||!row.at("operationId").isNull()||
         row.at("canonicalPayload").scalar!=canonicalPayload||row.at("payloadSha256").scalar!=payloadSha||
         row.at("bytes").uintValue(16384)!=command.payload.count)throw Denied(10);
      existing=true;
    }
    if(!existing){
      if(original.generation==UINT64_MAX)throw Denied(4);
      Json next=original.payload;auto event=Json::objectValue();
      event.object={{"eventId",Json::string(command.event)},{"phase",Json::string("premutation")},
        {"operationId",Json()},{"canonicalPayload",Json::string(canonicalPayload)},
        {"payloadSha256",Json::string(payloadSha)},{"bytes",Json::number(std::to_string(command.payload.count))},
        {"state",Json::string("pending")},{"nativeReceipt",Json()}};
      next.object.at("outbox").array.push_back(std::move(event));
      next.object.at("generation")=Json::string(std::to_string(original.generation+1));
      next.object.at("previousPayloadSha256")=Json::string(hex(original.payloadSha));
      publishOriginalTransition(original,next,deadline);
    }
    Writer encoded(resultCap(Operation::PreacceptIntent),originalOwner_);
    encoded.u8(static_cast<std::uint8_t>(Operation::PreacceptIntent)+128);encoded.u32(command.sequence);encoded.u8(0);
    auto result=response(command,encoded);deadline.check();return result;
  }
};
}
