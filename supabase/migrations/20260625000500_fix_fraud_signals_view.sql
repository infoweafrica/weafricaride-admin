-- ============================================================
-- PATCH: Fix fraud_signals view — corrected table reference
-- ============================================================
DROP VIEW IF EXISTS fraud_signals;

CREATE OR REPLACE VIEW fraud_signals AS
SELECT
    'Rider: >5 cancels in 1h' AS signal_type,
    u.id AS user_id,
    u.phone,
    COUNT(*) AS count
FROM users u
JOIN trip_events te ON te.actor_id = u.id
WHERE te.event_type = 'state_transition'
  AND te.new_state = 'rider_cancelled'
  AND te.created_at > NOW() - INTERVAL '1 hour'
GROUP BY u.id, u.phone
HAVING COUNT(*) > 5

UNION ALL

SELECT
    'Driver: >30 trips in 6h',
    u.id,
    u.phone,
    COUNT(*) AS count
FROM users u
JOIN trip_events te ON te.actor_id = u.id
WHERE te.event_type = 'state_transition'
  AND te.new_state = 'completed'
  AND te.created_at > NOW() - INTERVAL '6 hours'
GROUP BY u.id, u.phone
HAVING COUNT(*) > 30

UNION ALL

SELECT
    'Driver: no GPS update in 2min',
    d.user_id,
    u.phone,
    EXTRACT(EPOCH FROM (NOW() - d.last_location_update))::INTEGER AS count
FROM drivers d
JOIN users u ON u.id = d.user_id
WHERE d.status = 'online'
  AND d.last_location_update < NOW() - INTERVAL '2 minutes';