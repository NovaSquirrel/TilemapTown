import sqlite3, json, zlib

Database = sqlite3.connect("shrinkme.db", detect_types=sqlite3.PARSE_DECLTYPES|sqlite3.PARSE_COLNAMES)
c = Database.cursor()
write = Database.cursor()

for row in c.execute('SELECT id, data, compressed_data, type FROM Entity'):
	entity_id, entity_data, entity_compressed_data, entity_type = row
	print(entity_id, "type", entity_type, "data", len(entity_data or []), "comp", len(entity_compressed_data or []))
	if entity_data and len(entity_data) >= 500 and not entity_compressed_data:
		write.execute("UPDATE Entity SET data='zlib', compressed_data=? WHERE id=?", (zlib.compress(entity_data.encode(), level = 9), entity_id,))
Database.commit()
c.execute("VACUUM")
Database.commit()
Database.close()
