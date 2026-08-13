
# GmailIntakeItem

## Properties
| Name | Type | Description | Notes |
| ------------ | ------------- | ------------- | ------------- |
| **id** | **kotlin.String** | Organization-scoped CommunicationEvent id. Stable identity for a later Owner Review-with-Rocket request. Not a Gmail API message id.  |  |
| **fromAddress** | **kotlin.String** | Sender address already stored on the A5 CommunicationEvent. |  |
| **receivedAt** | **kotlin.String** |  |  |
| **subject** | **kotlin.String** |  |  [optional] |
| **snippet** | **kotlin.String** | Capped A5 preview already stored on the event. Not the TemporaryCommunicationExcerpt body and not a raw Gmail payload.  |  [optional] |



