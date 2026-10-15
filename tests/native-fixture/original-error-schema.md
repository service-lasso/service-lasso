# Private original error graph/source schema

This closed private data grammar is part of #1687 U1 source, UNEXECUTED and
without ROOT/actor/issuer authority. Original source/native ABI/isolate and
caller/held-object binding remain independent mandatory admission records.

SLF7GRF1 retains its 24-byte graph and 32-byte node headers. Node kind is the
low byte at offset 5. Offset 4 contains three two-bit name/message/stack states:
0 exact string, 1 absent, 2 undefined, 3 null. High two bits must be zero; a
non-string state has zero UTF16 units. Strings preserve every original code
unit, including unpaired surrogates, with no coercion or JSON encoding.
Cause state independently distinguishes absent/reference/undefined/null;
reference IDs preserve original object cycles and repeated object identity.
Primary is the actual caught original object, and secondary IDs retain original
order and repeats. AggregateError.errors IDs retain actual original order.

Kinds 1/2 are Error/AggregateError, 3 typed scalar, 4 raw native record, 5/6
ordinary object/array. Error/object/array native-detail fields contain exactly
SLF7PRP1: 8 magic bytes, four-byte big-endian own-property count, four-byte prototype kind, then ordered
records of four-byte UTF16 key-unit count, four-byte graph-local value ID and
exact big-endian UTF16 key units. Counts, bounds, IDs and duplicate keys are
validated; original own enumeration order is preserved. Prototype kinds are 0 native Error-family, 1 original plain-object prototype, 2 null prototype and 3 original array prototype. A generic object with another prototype fails incomplete rather than losing native/internal state. Arrays include their
actual own length/index properties, so holes remain distinct from undefined.
Shared cause/custom-property objects and arrays are actual same-isolate graph
nodes. Scalar identity is never deduplicated through strict equality: +0/-0
must retain their exact native numeric representations.

Typed scalar native bytes use a closed first-byte tag: 1 undefined, 2 null,
3 exact UTF16 string held in message, 4 boolean plus one 0/1 byte, 5 original
IEEE754 double bits in eight big-endian bytes, 6 BigInt sign byte + big-endian
word count + exact big-endian 64-bit words in original low-to-high order. BigInt
zero has no words and no negative sign; leading zero high words are rejected.
Raw native kind 4 preserves original native bytes unchanged, including private
PowerShell/native error records; no native bytes are interpreted as JS text.

The producer uses actual Node-API handles and reads properties only in the
original caller's live native handle scope. It remembers already observed
Error fields and AggregateError elements so graph/property detail never causes
a second getter read of those values. No replacement Error, worker isolate or
JSON simulator exists. Original primary/secondary/cause handles remain retained
by the owning adapter on failure. A new serialization exception is captured as
the actual same-isolate exception and restored as pending; it never replaces
the retained primary. Unsupported function/symbol/external values and symbolic
keys are incomplete capture, with originals retained, rather than coercion or
fabricated source. Full original producer failure/retention regressions remain
required; this explicit unsupported state cannot qualify a fixture that needs
those original values captured successfully.

Workspace geometry and source/CPU/memory/native allocator inputs require real
row admission. Frame-bounded loops alone cannot bound arbitrary original getter
code, VM allocation or native system calls. The original ROOT admission must
bind the exact original W code and all dependencies; no universal bound follows.

Node-API implementation was authored against the official
[Node-API documentation](https://nodejs.org/api/n-api.html), including exact
UTF16 copying, original strict identity, native exception and BigInt-word APIs.
The page is advisory source data, not a pinned native header/runtime input.
Actual exact Node headers/import libraries/runtime and source admission remain
ABSENT; CMake refuses absent exact header input before invoking a compiler.
