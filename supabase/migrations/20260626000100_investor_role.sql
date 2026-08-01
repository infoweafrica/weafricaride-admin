-- =============================================
-- WeAfrica Ride — Investor (Read-Only) Role
-- =============================================
-- Grants view_analytics + export_data permissions
-- so external investors can view dashboards &
-- reports without being able to modify anything.
-- =============================================

-- 1. Insert the "investor" role if it doesn't already exist
INSERT INTO admin_roles (name, description)
VALUES ('investor', 'Read-only investor — can view dashboards, reports, and export data')
ON CONFLICT (name) DO NOTHING;

-- 2. Assign view_analytics and export_data permissions
-- Uses admin_permissions lookup to find the correct permission IDs
DO $$
DECLARE
    v_investor_role_id UUID;
    v_view_analytics_perm_id UUID;
    v_export_data_perm_id UUID;
BEGIN
    -- Get the investor role ID
    SELECT id INTO v_investor_role_id FROM admin_roles WHERE name = 'investor';
    IF v_investor_role_id IS NULL THEN
        RAISE EXCEPTION 'Could not find investor role';
    END IF;

    -- Get permission IDs
    SELECT id INTO v_view_analytics_perm_id FROM admin_permissions WHERE name = 'view_analytics';
    SELECT id INTO v_export_data_perm_id FROM admin_permissions WHERE name = 'export_data';

    -- Insert view_analytics permission for investor
    IF v_view_analytics_perm_id IS NOT NULL THEN
        INSERT INTO role_permissions (role_id, permission_id)
        VALUES (v_investor_role_id, v_view_analytics_perm_id)
        ON CONFLICT DO NOTHING;
    END IF;

    -- Insert export_data permission for investor
    IF v_export_data_perm_id IS NOT NULL THEN
        INSERT INTO role_permissions (role_id, permission_id)
        VALUES (v_investor_role_id, v_export_data_perm_id)
        ON CONFLICT DO NOTHING;
    END IF;
END;
$$;