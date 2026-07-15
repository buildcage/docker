// Package events is buildkit-proxy's structured, single-line event log —
// the shape control's Solve/Session/FileSync interception emits anything
// worth surfacing to the report action as a GitHub Actions annotation. See
// report/src/lib/annotation.js's notice/warning/error methods, which
// report/src/main.js selects between via report.events[].level (see
// docker/tools/explicit/lib/buildkitd-log-parser.js's parseBuildcageEvents,
// the counterpart that reads what Log below writes).
package events

import (
	"encoding/json"
	"log"
)

// Level maps directly to a GitHub Actions annotation kind.
type Level string

const (
	LevelNotice  Level = "notice"
	LevelWarning Level = "warning"
	LevelError   Level = "error"
)

// Event is buildkit-proxy's single structured shape for anything worth
// surfacing to the report action as an annotation. Ref and SessionID are
// both optional and mutually exclusive in practice: Solve-triggered events
// are tied to a specific SolveRequest.Ref, while Session/FileSync-triggered
// events are tied to a Session (SessionID) — a single Session can be shared
// by several Solve calls (e.g. bake), so FileSync-level code has no
// reliable way to attribute an event to one particular ref.
type Event struct {
	Type      string `json:"type"`
	Level     Level  `json:"level"`
	Message   string `json:"message"`
	Ref       string `json:"ref,omitempty"`
	SessionID string `json:"sessionID,omitempty"`
}

// Log emits a single-line, machine-parseable log entry. It relies on
// main.go having pointed the standard log package's output at the same file
// report.js reads (see bootstrap.StartBuildkitd's doc comment) — without
// that, this still goes to stderr (visible via `docker compose logs`) but
// never reaches the report pipeline.
func Log(e Event) {
	b, err := json.Marshal(e)
	if err != nil {
		log.Printf("buildcage: failed to marshal event %+v: %v", e, err)
		return
	}
	log.Printf("buildcage: event=%s", b)
}
