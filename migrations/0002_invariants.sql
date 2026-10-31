CREATE UNIQUE INDEX one_published_listing_per_copy ON listings(edition_copy_id) WHERE status='PUBLISHED';
CREATE FUNCTION protect_immutable_records() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Immutable audit/event record' USING ERRCODE='23514'; END $$;
CREATE TRIGGER audit_immutable BEFORE UPDATE OR DELETE ON audit_events FOR EACH ROW EXECUTE FUNCTION protect_immutable_records();
CREATE TRIGGER deal_events_immutable BEFORE UPDATE OR DELETE ON deal_events FOR EACH ROW EXECUTE FUNCTION protect_immutable_records();
CREATE TRIGGER policy_immutable BEFORE UPDATE OR DELETE ON commission_policies FOR EACH ROW EXECUTE FUNCTION protect_immutable_records();
CREATE FUNCTION protect_financial_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.amount_minor IS DISTINCT FROM NEW.amount_minor OR OLD.commission_snapshot IS DISTINCT FROM NEW.commission_snapshot THEN RAISE EXCEPTION 'Immutable financial snapshot' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER deal_snapshot_immutable BEFORE UPDATE ON deals FOR EACH ROW EXECUTE FUNCTION protect_financial_snapshot();
CREATE TRIGGER offer_snapshot_immutable BEFORE UPDATE ON offers FOR EACH ROW EXECUTE FUNCTION protect_financial_snapshot();
CREATE FUNCTION check_edition_number() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v edition_variants%ROWTYPE;
BEGIN
 SELECT * INTO v FROM edition_variants WHERE id=NEW.variant_id FOR SHARE;
 IF v.edition_type='OPEN' AND NEW.number IS NOT NULL THEN RAISE EXCEPTION 'OPEN edition cannot have numbered limited copies' USING ERRCODE='23514'; END IF;
 IF v.edition_type='LIMITED' AND (NEW.number IS NULL OR NEW.number<1 OR NEW.number>CASE WHEN NEW.proof_type='AP' THEN v.ap_total ELSE v.edition_total END) THEN RAISE EXCEPTION 'Edition number outside declared run' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER copy_edition_number BEFORE INSERT OR UPDATE ON edition_copies FOR EACH ROW EXECUTE FUNCTION check_edition_number();
