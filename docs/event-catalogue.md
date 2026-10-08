# Event Catalogue

Living documentation of every domain event published through the transactional
outbox, its payload, and its consumers. Source of truth is the
`OutboxEventEntity` save site plus the `@RabbitSubscribe` consumer; payload
fields are copied from the `payload: {...}` literal.

Exchanges declared in `src/app.module.ts`: `auth_exchange`,
`appointment_exchange`, `payment_exchange`, `ai_exchange` plus `.dlx` each.
Publish uses the eventType as routing key with `x-event-id` header
(`src/common/outbox/services/outbox-processor.service.ts`).

## Outbox events

| event | exchange | publisher (module + txn note) | payload fields | consumers |
|---|---|---|---|---|
| `user.registered` | `auth_exchange` | auth `signup.use-case.ts` + `resend-otp.use-case.ts`, same txn as user row save | userId, email, otpCode | `auth-rabbitmq.consumer` `user_registration_queue` + `user_registration_queue.dlq` |
| `guest.promoted` | `auth_exchange` | auth `signup.use-case.ts`, same txn, only when guestDeviceId present | guestDeviceId, userId, bookingIntent | `guest-promotion.consumer` `guest_promotion_queue` (no DLQ) |
| `session.created` | `auth_exchange` | auth `verify-email.use-case.ts` + `sign-in.use-case.ts`, same txn as token family row | userId, familyId, deviceLabel, createdAt | `session-rabbitmq.consumer` `session_created_queue` (log-only, no DLQ) |
| `session.ended` | — (missing at publish site, bug: processor skips) | auth `sign-out.use-case.ts`, separate save after revoke | userId, familyId, endedAt, reason | `session-rabbitmq.consumer` `session_ended_queue` (never receives) |
| `session.theft_detected` | — (missing at publish site, bug: processor skips) | auth `refresh-token.use-case.ts` `publishTheftEvent`, separate save | userId, familyId, detectedAt | `session-rabbitmq.consumer` `session_theft_detected_queue` (never receives) |
| `user.password_reset_requested` | `auth_exchange` | auth `request-password-reset.use-case.ts`, same txn | userId, channel, target, resetCode | none (email sent directly via mailService) |
| `slot.held` | — (missing at publish site, bug: processor skips) | booking `create-hold.use-case.ts`, same txn as hold row | holdId, patientId, doctorId, clinicId, date, startTime, frozenFee, expiresAt | none |
| `HOLD_EXPIRED` | `appointment_exchange` | booking `release-expired-holds.use-case.ts` cron, same txn as hold → EXPIRED | holdId, patientId, doctorId, clinicId, date, startTime | none |
| `APPOINTMENT_BOOKED` | `appointment_exchange` | payment `process-payment.use-case.ts` + `handle-stripe-webhook.use-case.ts` + `payment-reconciliation.service.ts` heal, same txn as appointment row | appointmentId, userId, patientId, holdId, doctorId, clinicId, date, startTime, endTime, instructions | `appointment-notification.consumer` `appointment_confirmation_email_queue` + dlq; `appointment-reminder-scheduling.consumer` `appointment_reminder_schedule_queue` + dlq |
| `APPOINTMENT_CANCELLED` | `appointment_exchange` | booking `cancel-appointment.use-case.ts`, same txn | appointmentId, patientId, doctorId, clinicId, holdId, date, startTime, cancelledAt, cancellationOutcome | `appiontment-cancle.consumer` `appointment_cancelled_slot_release_queue` + dlq |
| `APPOINTMENT_RESCHEDULED` | `appointment_exchange` | booking `reschedule-appointment.use-case.ts`, same txn | appointmentId, patientId, doctorId, clinicId, oldDate, oldStartTime, date, startTime, endTime, rescheduleCount, rescheduledAt | none |
| `APPOINTMENT_COMPLETED` | `appointment_exchange` | booking `complete-appointments.use-case.ts` cron, same txn as BOOKED → COMPLETED | appointmentId, patientId, doctorId, clinicId, date, startTime | none |
| `APPOINTMENT_NO_SHOW` | `appointment_exchange` | booking `complete-appointments.use-case.ts` cron, same txn as BOOKED → NO_SHOW | appointmentId, patientId, doctorId, clinicId, date, startTime | none |
| `REMINDER_DUE` | `appointment_exchange` | booking `send-due-reminders.use-case.ts` cron, same txn as reminder → SENT | appointmentId, patientId, doctorId, clinicId, date, startTime, reminderId | `reminder-notification.consumer` `reminder_due_notification_queue` + dlq |
| `PAYMENT_SUCCEEDED` | `payment_exchange` | payment `process-payment.use-case.ts` + `handle-stripe-webhook.use-case.ts`, same txn | userId, paymentTxId, holdId, amount, providerReference | none |
| `PAYMENT_FAILED` | `payment_exchange` | payment `process-payment.use-case.ts` handleFailure + `handle-stripe-webhook.use-case.ts`, same txn | paymentTxId, holdId, reason, userId (webhook variant) | none |
| `PAYMENT_METHOD_ADDED` | `payment_exchange` | payment `add-saved-card.use-case.ts`, same txn as card row | userId, cardId, cardBrand, last4Digits, addedAt | none |
| `PAYMENT_METHOD_REMOVED` | `payment_exchange` | payment `delete-saved-card.use-case.ts` + `process-payment.use-case.ts` invalid-card path, same txn | userId, cardId, last4Digits, removedAt, reason (invalid-card variant) | none |
| `DEFAULT_PAYMENT_METHOD_CHANGED` | `payment_exchange` | payment `update-saved-card.use-case.ts`, same txn, only when isDefault true | userId, cardId, updatedAt | none |
| `REFUND_ISSUED` | `payment_exchange` | payment `refund.service.ts` markIssued, same txn PENDING → ISSUED | refundId, appointmentId, userId, amount, providerRefundId, expectedArrivalAt | `refund-notification.consumer` `refund_issued_email_queue` + dlq |
| `refund.settled` | `payment_exchange` | payment `refund.service.ts` settle cron, same txn ISSUED → SETTLED | refundId, appointmentId, settledAt | none |
| `payment.reconciled` | `payment_exchange` | payment `payment-reconciliation.service.ts`, same txn (FAILED and HEALED paths) | paymentTxId, holdId, outcome, appointmentId (HEALED only) | none |
| `doctor.favorited` | — (missing at publish site, bug: processor skips) | catalog `add-favorite.use-case.ts`, same txn, only when new | userId, doctorId, doctorName | `notification favorite-notification.consumer` `favorite_notifications_queue`; `catalog favorite-notification.consumer` `favorite_notifications_queue` (never receive) |
| `doctor.unfavorited` | — (missing at publish site, bug: processor skips) | catalog `remove-favorite.use-case.ts`, same txn, only when deleted | userId, doctorId | none |
| `PRESCRIPTION_ISSUED` | `appointment_exchange` | prescription `attach-prescription.use-case.ts` + `replace-prescription.use-case.ts`, same txn as prescription row save (outbox) | prescriptionId, appointmentId, patientId, doctorId, clinicId, issuedAt, issuedBy | `prescription-notification.consumer` `prescription_notification_queue` + dlq → patient inbox entry |
| `AI_MESSAGE_ANSWERED` | `ai_exchange` | ai-assistant `send-ai-message.use-case.ts`, same txn as message → SUCCESS | conversationId, messageId, patientId, deviceId, model, tokensIn, tokensOut, durationMs, specialtySuggestion, timestamp | `ai-events.consumer` `ai_analytics_queue` + dlq |
| `AI_CONVERSATION_DELETED` | `ai_exchange` | ai-assistant `delete-ai-conversation.use-case.ts`, same txn as deletes | conversationId, patientId, deviceId, deletedAt | none |

Consumed but never published: `PATIENT_ACCOUNT_DELETED` on `auth_exchange`
(`ai-events.consumer` `ai_patient_deletion_queue`) has no outbox publish site;
account-deletion flow is out of scope.

## Analytics-only events (outbox row, no exchange, never published)

Fire-and-forget analytics writes without `exchange`; the processor skips them
per `outbox-processor.service.ts:31-36`. Transport noted, not mixed into the
outbox table above.

| event | transport | publisher | payload fields |
|---|---|---|---|
| `catalog.doctor_profile_viewed` | outbox row, no exchange (skipped) | catalog `get-doctor-profile.use-case.ts` | doctorId, userId, viewedAt |
| `catalog.filters_applied` | outbox row, no exchange (skipped) | catalog `list-filtered-doctors.use-case.ts` | filters, sort, userId, appliedAt |
| `HOME_PAGE_OPENED` | outbox row, no exchange (skipped) | catalog `get-home-dashboard.use-case.ts` | userId, ipAddress, openedAt |
| `MapRegionSearched` | outbox row, no exchange (skipped) | catalog `search-map.use-case.ts` | userId, north, south, east, west, userLatitude, userLongitude, specialtyId, searchedAt |
