/** A filtered UPDATE can affect zero rows without an HTTP error. Require its persisted timing. */
export async function persistCalendarTiming(client: any, id: string, updates: Record<string,string>) {
  const {data,error}=await client.from('meetings').update(updates).eq('id',id)
    .select('id,request_date,start_time,end_time,duration').single();
  if(error)throw error;
  if(!data||data.id!==id||!data.start_time||!data.end_time)throw new Error('MEETING_TIMING_NOT_SAVED');
  return data;
}
export function meetingTimingPlaceholders(meeting: {id:string;start_time:string|null;end_time:string|null}) {
  return {meeting_id:meeting.id,start_time:meeting.start_time||'',end_time:meeting.end_time||''};
}
