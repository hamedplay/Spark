-- Per-channel unread counts for a user (matches get_unread_counts pattern used in Chat)
DROP FUNCTION IF EXISTS public.get_channel_unread_counts(uuid);

CREATE FUNCTION public.get_channel_unread_counts(p_user_id uuid)
RETURNS TABLE(channel_id uuid, unread_count bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT cm.channel_id, COUNT(*)::bigint AS unread_count
  FROM channel_messages cm
  INNER JOIN channel_members mem
    ON mem.channel_id = cm.channel_id AND mem.user_id = p_user_id
  WHERE cm.sender_id != p_user_id
    AND cm.deleted_for_all = false
    AND NOT (COALESCE(cm.read_by, ARRAY[]::text[]) @> ARRAY[p_user_id::text])
  GROUP BY cm.channel_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_channel_unread_counts(uuid) TO authenticated;
