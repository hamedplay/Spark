-- Drop the old 2-argument overload; the 3-argument version (with ban check) is the only one we need
DROP FUNCTION IF EXISTS validate_room_join(uuid, text);
