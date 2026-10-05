// SOURCE ONLY; never compiled/imported/executed in this author unit.
// These prospective native cases exercise the real source API. They do not
// provide a realm, image, peer, admitted kernel tuple or qualification object.
#include "original-clock-domain.hpp"
#include <cassert>
#include <thread>

namespace slcore::prospective {
void actualThreadObservationAndConservativeCharge(Budget& originalOwner,Deadline& originalAcquisition){
  const auto before=originalOwner.used();
  auto custody=OriginalClockThreadCustody::retainOriginalSamplingThread(originalOwner,originalAcquisition);
  assert(custody->sameOriginalOwner(originalOwner));
  assert(originalOwner.used()>before);
  // A denied native acquisition remains an owned failed object, never an
  // invented successful positive and never a skipped rights assertion.
  assert(custody->acquired());
  const auto observed=custody->sampleOriginal();
  assert(observed.process==custody->originalProcess());
  assert(observed.thread==custody->originalThread());
  assert(observed.frequency>0&&custody->observationCount()>0);
  const auto charged=originalOwner.used();
  assert(custody->closeNativeCustody());
  assert(!custody->acquired()&&!custody->closureUnresolved());
  // Successful native handle close alone does not retire retained metadata.
  assert(originalOwner.used()==charged);
}
void actualForeignSamplingThreadDenies(Budget& owner,Deadline& originalAcquisition){
  auto custody=OriginalClockThreadCustody::retainOriginalSamplingThread(owner,originalAcquisition);
  assert(custody->acquired());bool denied=false;
  std::thread foreign([&]{try{custody->sampleOriginal();}catch(const Denied&){denied=true;}});
  foreign.join();assert(denied&&custody->failed()&&!custody->acquired());
  assert(custody->originalFailure());
  // Borrowed raw original acquisition remains visible after failed sampling.
  assert(custody->observationCount()>0);
  assert(custody->observation(0).operation[0]!=0);
}
void actualFiniteObservationExhaustionDeniesWithoutReplacement(Budget& owner,Deadline& originalAcquisition){
  auto custody=OriginalClockThreadCustody::retainOriginalSamplingThread(owner,originalAcquisition);
  assert(custody->acquired());const auto first=custody->observation(0);bool denied=false;
  for(unsigned attempt=0;attempt<128&&!denied;++attempt){
    try{custody->sampleOriginal();}catch(const Denied&){denied=true;}
  }
  assert(denied&&custody->failed());
  assert(std::memcmp(first.operation,custody->observation(0).operation,sizeof(first.operation))==0);
  assert(first.result==custody->observation(0).result);
  // This case exposes the partial fixed-history limitation. It is NOT full
  // 64MiB journey acceptance. Whole source must resolve retained-history
  // allocation/lifetime before integration as a positive D1 producer.
}
}
