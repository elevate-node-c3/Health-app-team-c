# Event Catalogue

Living documentation of every domain event published through the transactional
outbox, its payload, and its consumers. ENG-7 completes this catalogue.

| event | exchange | publisher (module + txn note) | payload fields | consumers |
|---|---|---|---|---|
| `PRESCRIPTION_ISSUED` | `appointment_exchange` | prescription module, same txn as prescription row save (outbox) | prescriptionId, appointmentId, patientId, doctorId, clinicId, issuedAt, issuedBy | prescription-notification consumer → patient inbox entry |
