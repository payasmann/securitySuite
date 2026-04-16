package onvif

import (
	"bytes"
	"crypto/rand"
	"crypto/sha1"
	"encoding/base64"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// EventSubscription represents an active ONVIF event subscription.
type EventSubscription struct {
	hostname string
	port     int
	username string
	password string
	callback func([]byte)
	stopCh   chan struct{}
	stopped  bool
}

// Close stops the event subscription polling loop.
func (s *EventSubscription) Close() {
	if !s.stopped {
		s.stopped = true
		close(s.stopCh)
	}
}

// Subscribe connects to an ONVIF camera and starts polling for events.
// It uses the PullPoint subscription mechanism (most widely supported).
func Subscribe(hostname string, port int, username, password string, callback func([]byte)) (*EventSubscription, error) {
	sub := &EventSubscription{
		hostname: hostname,
		port:     port,
		username: username,
		password: password,
		callback: callback,
		stopCh:   make(chan struct{}),
	}

	// First, get the device service capabilities to find the events service
	eventsURL := fmt.Sprintf("http://%s:%d/onvif/Events", hostname, port)

	// Try to create a PullPoint subscription
	subscriptionRef, err := createPullPointSubscription(eventsURL, username, password)
	if err != nil {
		return nil, fmt.Errorf("create PullPoint subscription: %w", err)
	}

	// Start polling for events
	go sub.pollEvents(subscriptionRef)

	return sub, nil
}

// createPullPointSubscription creates a WS-PullPoint subscription on the camera.
func createPullPointSubscription(eventsURL, username, password string) (string, error) {
	soapBody := `<?xml version="1.0" encoding="UTF-8"?>
<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"
            xmlns:tev="http://www.onvif.org/ver10/events/wsdl">
  <s:Header>` + wsseHeader(username, password) + `</s:Header>
  <s:Body>
    <tev:CreatePullPointSubscription>
      <tev:InitialTerminationTime>PT60S</tev:InitialTerminationTime>
    </tev:CreatePullPointSubscription>
  </s:Body>
</s:Envelope>`

	resp, err := http.Post(eventsURL, "application/soap+xml; charset=utf-8", strings.NewReader(soapBody))
	if err != nil {
		return "", fmt.Errorf("HTTP request failed: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("read response: %w", err)
	}

	if resp.StatusCode != 200 {
		return "", fmt.Errorf("HTTP %d: %s", resp.StatusCode, string(body))
	}

	// Extract the subscription reference address from the response
	// Look for <Address> tag in the SubscriptionReference
	bodyStr := string(body)
	addrStart := strings.Index(bodyStr, "<Address>")
	if addrStart == -1 {
		// Try with namespace prefix
		addrStart = strings.Index(bodyStr, ":Address>")
		if addrStart == -1 {
			return "", fmt.Errorf("no subscription address in response: %s", bodyStr)
		}
		// Find the actual start of the tag
		for addrStart > 0 && bodyStr[addrStart] != '<' {
			addrStart--
		}
	}

	addrEnd := strings.Index(bodyStr[addrStart:], "</")
	if addrEnd == -1 {
		return "", fmt.Errorf("malformed subscription address")
	}

	// Extract just the address value
	tagContent := bodyStr[addrStart : addrStart+addrEnd]
	gtIdx := strings.Index(tagContent, ">")
	if gtIdx == -1 {
		return "", fmt.Errorf("malformed address tag")
	}
	address := strings.TrimSpace(tagContent[gtIdx+1:])

	return address, nil
}

// pollEvents continuously pulls events from the PullPoint subscription.
func (s *EventSubscription) pollEvents(subscriptionRef string) {
	renewTicker := time.NewTicker(50 * time.Second) // Renew before 60s timeout
	defer renewTicker.Stop()

	for {
		select {
		case <-s.stopCh:
			return
		default:
		}

		// Pull messages
		data, err := pullMessages(subscriptionRef, s.username, s.password)
		if err != nil {
			// Silently retry — camera may be temporarily unavailable
			select {
			case <-s.stopCh:
				return
			case <-time.After(5 * time.Second):
				continue
			}
		}

		if len(data) > 0 {
			s.callback(data)
		}

		select {
		case <-s.stopCh:
			return
		case <-renewTicker.C:
			// Renew the subscription
			renewSubscription(subscriptionRef, s.username, s.password)
		case <-time.After(1 * time.Second):
			// Short delay between polls
		}
	}
}

// pullMessages sends a PullMessages request to the subscription endpoint.
func pullMessages(subscriptionRef, username, password string) ([]byte, error) {
	soapBody := `<?xml version="1.0" encoding="UTF-8"?>
<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"
            xmlns:tev="http://www.onvif.org/ver10/events/wsdl">
  <s:Header>` + wsseHeader(username, password) + `</s:Header>
  <s:Body>
    <tev:PullMessages>
      <tev:Timeout>PT5S</tev:Timeout>
      <tev:MessageLimit>10</tev:MessageLimit>
    </tev:PullMessages>
  </s:Body>
</s:Envelope>`

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Post(subscriptionRef, "application/soap+xml; charset=utf-8", strings.NewReader(soapBody))
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("HTTP %d", resp.StatusCode)
	}

	// Only return data if there are actual notification messages
	if strings.Contains(string(body), "NotificationMessage") {
		return body, nil
	}

	return nil, nil
}

// renewSubscription renews the PullPoint subscription.
func renewSubscription(subscriptionRef, username, password string) {
	soapBody := `<?xml version="1.0" encoding="UTF-8"?>
<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"
            xmlns:wsnt="http://docs.oasis-open.org/wsn/b-2">
  <s:Header>` + wsseHeader(username, password) + `</s:Header>
  <s:Body>
    <wsnt:Renew>
      <wsnt:TerminationTime>PT60S</wsnt:TerminationTime>
    </wsnt:Renew>
  </s:Body>
</s:Envelope>`

	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Post(subscriptionRef, "application/soap+xml; charset=utf-8", strings.NewReader(soapBody))
	if err != nil {
		return
	}
	resp.Body.Close()
}

// wsseHeader generates a WS-Security UsernameToken header for ONVIF authentication.
func wsseHeader(username, password string) string {
	nonce := make([]byte, 16)
	rand.Read(nonce)
	nonceB64 := base64.StdEncoding.EncodeToString(nonce)

	created := time.Now().UTC().Format("2006-01-02T15:04:05.000Z")

	// Password digest: Base64(SHA1(nonce + created + password))
	h := sha1.New()
	h.Write(nonce)
	h.Write([]byte(created))
	h.Write([]byte(password))
	digest := base64.StdEncoding.EncodeToString(h.Sum(nil))

	var buf bytes.Buffer
	buf.WriteString(`<wsse:Security xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd"`)
	buf.WriteString(` xmlns:wsu="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd">`)
	buf.WriteString(`<wsse:UsernameToken>`)
	buf.WriteString(fmt.Sprintf(`<wsse:Username>%s</wsse:Username>`, username))
	buf.WriteString(fmt.Sprintf(`<wsse:Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordDigest">%s</wsse:Password>`, digest))
	buf.WriteString(fmt.Sprintf(`<wsse:Nonce EncodingType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-soap-message-security-1.0#Base64Binary">%s</wsse:Nonce>`, nonceB64))
	buf.WriteString(fmt.Sprintf(`<wsu:Created>%s</wsu:Created>`, created))
	buf.WriteString(`</wsse:UsernameToken>`)
	buf.WriteString(`</wsse:Security>`)

	return buf.String()
}
