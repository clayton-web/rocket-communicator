
# CreateMessagesReviewRequest

## Properties
| Name | Type | Description | Notes |
| ------------ | ------------- | ------------- | ------------- |
| **sourceOccurrenceId** | **kotlin.String** | Opaque Google Messages source occurrence identity chosen by the Owner. The server owns canonical provenance construction from this value. It is not a phone number, sender name, or conversation title, and it is not a CommunicationEvent id.  |  |
| **selectedText** | **kotlin.String** | Plain text of the explicitly selected eligible one-to-one Google Messages occurrence. Persisted only as TemporaryCommunicationExcerpt at this Review boundary. Not echoed in the response and not written to audit notes.  |  |
| **observedAt** | **kotlin.String** | When the eligible occurrence was observed on the device. An explicit UTC designator or numeric offset is required. The server uses this as interpretation &#x60;capturedAt&#x60;; clients do not send &#x60;capturedAt&#x60;, &#x60;sourceKind&#x60;, or &#x60;organizationId&#x60;.  |  |



