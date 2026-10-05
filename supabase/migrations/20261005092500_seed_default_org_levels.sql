-- Persist the built-in organization levels so adding the first custom level
-- does not make the UI replace all virtual defaults with that single DB row.
-- Existing customized rows are preserved by the UNIQUE(level) conflict guard.

insert into public.org_level_definitions (level, label, color, icon, sort_order)
values
  (1, 'مدیرعامل',      '#ef4444', '👑', 1),
  (2, 'معاون',         '#f97316', '⭐', 2),
  (3, 'مدیر',          '#3b82f6', '💼', 3),
  (4, 'رئیس اداره',    '#8b5cf6', '🏛️', 4),
  (5, 'معاون اداره',   '#06b6d4', '📋', 5),
  (6, 'کارشناس ارشد',  '#10b981', '🔧', 6),
  (7, 'کارشناس',       '#14b8a6', '📊', 7),
  (8, 'کارمند',        '#6b7280', '👤', 8)
on conflict (level) do nothing;
