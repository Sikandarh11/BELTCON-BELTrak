insert into public.readers (id, name, model, zone, ip, status, read_rate) values
  ('RDR-001', 'Reclaim Belt 1 Reader', 'ThingMagic IZAR', 'RECLAIM_BELT_1', '10.42.7.11', 'ONLINE', 98),
  ('RDR-002', 'Reclaim Belt 2 Reader', 'ThingMagic IZAR', 'RECLAIM_BELT_2', '10.42.7.12', 'ONLINE', 96),
  ('RDR-003', 'Reclaim Belt 3 Reader', 'ThingMagic IZAR', 'RECLAIM_BELT_3', '10.42.7.13', 'ONLINE', 94),
  ('RDR-004', 'Arrival Hall Portal',   'ThingMagic IZAR', 'ARRIVAL_HALL',   '10.42.7.14', 'ONLINE', 99),
  ('RDR-007', 'Employee Entrance',     'ThingMagic IZAR', 'EMPLOYEE_EXIT',  '10.42.7.17', 'DEGRADED', 71),
  ('RDR-012', 'Lost & Found Reader',   'ThingMagic IZAR', 'LOST_FOUND',     '10.42.7.22', 'ONLINE', 95),
  ('RDR-019', 'Washroom North Reader', 'ThingMagic IZAR', 'WASHROOM_NORTH', '10.42.7.29', 'DEGRADED', 68),
  ('RDR-020', 'Washroom South Reader', 'ThingMagic IZAR', 'WASHROOM_SOUTH', '10.42.7.30', 'OFFLINE', 0),
  ('RDR-021', 'Customs Exit Gate 1',   'ThingMagic IZAR', 'CUSTOMS_EXIT_GATE_1', '10.42.7.31', 'ONLINE', 99),
  ('RDR-022', 'Customs Exit Gate 2',   'ThingMagic IZAR', 'CUSTOMS_EXIT_GATE_2', '10.42.7.32', 'ONLINE', 99),
  ('RDR-023', 'Customs Exit Gate 3',   'ThingMagic IZAR', 'CUSTOMS_EXIT_GATE_3', '10.42.7.33', 'ONLINE', 97),
  ('RDR-031', 'Emergency Exit West',   'ThingMagic IZAR', 'EMERGENCY_DOOR',      '10.42.7.41', 'ONLINE', 92)
on conflict (id) do nothing;
