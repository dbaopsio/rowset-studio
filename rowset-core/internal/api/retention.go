package api

import (
	"context"
	"time"
)

// retentionInterval is how often old activity is removed. The first pass
// waits a minute so it never competes with start-up.
const retentionInterval = 24 * time.Hour

var retentionDelay = time.Minute

// activityRetention removes audit entries and history older than the
// configured periods. A shared server uses its periods; a personal workspace
// is one person's own record, so nothing is deleted from it unless a period
// was set explicitly.
func (s *Server) activityRetention(ctx context.Context, audit, history *uint32) {
	if audit == nil && history == nil {
		return
	}
	timer := time.NewTimer(retentionDelay)
	defer timer.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-timer.C:
		}
		audits, histories, err := s.activity.Purge(ctx, audit, history)
		if err != nil {
			if ctx.Err() == nil {
				s.logger.Error("activity retention failed", "error", err)
			}
		} else if audits > 0 || histories > 0 {
			s.logger.Info("activity retention removed old entries", "audit", audits, "history", histories)
		}
		timer.Reset(retentionInterval)
	}
}

func (s *Server) retentionPeriods() (audit, history *uint32) {
	if !s.config.Shared && !s.config.RetentionConfigured {
		return nil, nil
	}
	return s.config.AuditRetentionDays, s.config.QueryHistoryRetentionDays
}
