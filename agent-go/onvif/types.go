package onvif

import "encoding/xml"

// NotificationEnvelope represents a parsed ONVIF notification.
type NotificationEnvelope struct {
	XMLName  xml.Name              `xml:"Envelope"`
	Messages []NotificationMessage `xml:"Body>Notify>NotificationMessage"`
}

// NotificationMessage represents a single notification within the envelope.
type NotificationMessage struct {
	Topic TopicExpression  `xml:"Topic"`
	Data  NotificationData `xml:"Message>Message>Data"`
}

// TopicExpression holds the topic value.
type TopicExpression struct {
	Value string `xml:",chardata"`
}

// NotificationData holds data items from the notification.
type NotificationData struct {
	SimpleItems []SimpleItem `xml:"SimpleItem"`
}

// SimpleItem represents a key-value pair in the notification data.
type SimpleItem struct {
	Name  string `xml:"Name,attr"`
	Value string `xml:"Value,attr"`
}
