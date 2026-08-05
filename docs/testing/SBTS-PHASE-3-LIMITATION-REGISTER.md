# SBTS Phase 3 limitation register

| ID         | Limitation                                       | Software behavior                                                               | Closure evidence                                          |
| ---------- | ------------------------------------------------ | ------------------------------------------------------------------------------- | --------------------------------------------------------- |
| LIM-P3-001 | Procured RFID barcode grammar unavailable        | Safe printable exact-case baseline; manual entry disabled                       | Supplier tag specification                                |
| LIM-P3-002 | EPC allocation/encoding layout unapproved        | Hex only, configurable 96/128-bit examples; no invented IATA encoding           | Approved EPC allocation document                          |
| LIM-P3-003 | Printer/encoder SDK and model unavailable        | Physical adapter explicitly unavailable; simulated job contract only            | Vendor SDK plus hardware FAT                              |
| LIM-P3-004 | RFID reader/antenna contract unavailable         | Physical verifier unavailable; stable reads simulated                           | Reader SDK and RF-site FAT                                |
| LIM-P3-005 | Camera model/SDK unavailable                     | Physical camera unavailable; PNG simulator and controlled dev upload            | Camera integration and image-quality FAT                  |
| LIM-P3-006 | Production object storage not selected           | Storage interface and fail-closed unavailable adapter; in-memory simulator only | Approved storage, encryption, retention and backup design |
| LIM-P3-007 | Label artwork/template unapproved                | Optional opaque template ID only; no vendor format invented                     | Approved label template                                   |
| LIM-P3-008 | Conveyor release interlock not implemented in P3 | Assignment and software queue completion do not claim physical release          | BHS/controls ICD and interlock FAT                        |
| LIM-P3-009 | Final BHS/HBSS ICDs absent                       | No new telegram, acknowledgement, framing, or response invented                 | Controlled final ICDs                                     |
| LIM-P3-010 | Physical throughput unknown                      | Software load is not a hardware benchmark                                       | End-to-end measured performance FAT                       |
| LIM-P3-011 | Station host packaging not validated             | Node/SQLite process behavior only                                               | Target workstation deployment and soak                    |
| LIM-P3-012 | Multi-site ownership model remains limited       | Trusted site/station binding for  workflow                               | Approved multi-site data-ownership design                 |
