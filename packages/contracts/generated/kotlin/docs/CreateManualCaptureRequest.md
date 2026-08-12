
# CreateManualCaptureRequest

## Properties
| Name | Type | Description | Notes |
| ------------ | ------------- | ------------- | ------------- |
| **rawInput** | **kotlin.String** | Owner capture text to interpret. Transient interpretation input only (D169): it is not persisted, not echoed in any response, not stored as a CommunicationEvent or excerpt, and never logged. Oversize input is rejected at the HTTP boundary rather than truncated.  |  |
| **capturedAt** | **kotlin.String** | When the Owner captured the input, in the caller&#39;s own words about the capture — not when the server processed it. An explicit UTC designator or numeric offset is required: a zone-less timestamp resolves against the host clock, so one retry could canonicalize to two instants and a legitimate replay would fail as a conflict. Fingerprinted request semantics, never defaulted from the server clock, and not subject to a recency window.  |  |
| **timezone** | **kotlin.String** | Owner/organization IANA timezone when known. Mechanical interpretation context only — it does not select an organization, a Recipient, or a responsibility.  |  [optional] |



