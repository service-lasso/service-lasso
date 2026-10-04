cmake_minimum_required(VERSION 3.25)
# SOURCE ONLY. Never configure/compile before DIFFERENT ENTIRE review and NEW
# complete ROOT. These variables identify inputs; they do not issue admission.
# Original ROOT must admit ALL compiler/CMake/SDK/linker/helper/ENV/loaded bytes
# before this project() can invoke any tool. Actual tool inputs remain ABSENT.
foreach(required_input CMAKE_C_COMPILER CMAKE_CXX_COMPILER
    F7_ADMITTED_SODIUM_INCLUDE F7_ADMITTED_SODIUM_LIBRARY
    F7_ADMITTED_NODE_INCLUDE
    F7_ADMITTED_PLATFORM_LIBRARIES)
  if(NOT DEFINED ${required_input} OR "${${required_input}}" STREQUAL "")
    message(FATAL_ERROR "Missing separately admitted native build input")
  endif()
endforeach()
foreach(path_input CMAKE_C_COMPILER CMAKE_CXX_COMPILER
    F7_ADMITTED_SODIUM_INCLUDE F7_ADMITTED_SODIUM_LIBRARY F7_ADMITTED_NODE_INCLUDE)
  if(NOT IS_ABSOLUTE "${${path_input}}")
    message(FATAL_ERROR "Native build input must be exact and absolute")
  endif()
endforeach()
foreach(platform_library IN LISTS F7_ADMITTED_PLATFORM_LIBRARIES)
  if(NOT IS_ABSOLUTE "${platform_library}")
    message(FATAL_ERROR "Native platform library must be exact and absolute")
  endif()
endforeach()
project(service_lasso_f7_u1_source LANGUAGES C CXX)
if(NOT CMAKE_SYSTEM_NAME STREQUAL "Windows" AND NOT CMAKE_SYSTEM_NAME STREQUAL "Linux")
  message(FATAL_ERROR "No selected native build source for this platform")
endif()
set(CMAKE_C_STANDARD 11)
set(CMAKE_C_STANDARD_REQUIRED ON)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
add_library(f7_u1_native STATIC
  protocol.c budget-reservation.c capture-spool.c read-capability.c
  async-spool.c witness.c witness-reader.c observer.c observer-finalize.c
  observer-linux.c observer-windows.cpp child-witness.c
  child-witness-linux.c child-witness-windows.cpp
  error-channel.c error-graph.c error-producer-endpoint.c error-producer-queue.c
  serialization-fallback.c original-error-node.cpp original-error-producer.cpp
  original-error-node-regression.cpp
  error-peer-linux.c canonical-index.c canonical-index-reader.c
  segment-record.c plaintext-manifest.c manifest-reader.c attempt-journal.c
  transport-crypto.c transport-package.c recovery.c recovery-linux.c
  recovery-windows.cpp public-projection.c)
target_include_directories(f7_u1_native PRIVATE "${F7_ADMITTED_SODIUM_INCLUDE}" "${F7_ADMITTED_NODE_INCLUDE}")
target_link_libraries(f7_u1_native PUBLIC "${F7_ADMITTED_SODIUM_LIBRARY}"
  ${F7_ADMITTED_PLATFORM_LIBRARIES})
# Unexecuted protocol regression only; this is not the full original native
# nine-row fixture owner and never supplies source GO or runtime acceptance.
add_executable(f7_protocol_regression protocol-native-regression.c)
target_include_directories(f7_protocol_regression PRIVATE "${F7_ADMITTED_SODIUM_INCLUDE}")
target_link_libraries(f7_protocol_regression PRIVATE f7_u1_native)
# No add_test/launch/profile/installation/cleanup/publication action exists.
