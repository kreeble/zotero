describe("Zotero.Schema", function() {
	describe("#initializeSchema()", function () {
		it("should set last client version", function* () {
			yield resetDB({
				thisArg: this,
				skipBundledFiles: true
			});
			
			var sql = "SELECT value FROM settings WHERE setting='client' AND key='lastVersion'";
			var lastVersion = yield Zotero.DB.valueQueryAsync(sql);
			yield assert.eventually.equal(Zotero.DB.valueQueryAsync(sql), Zotero.version);
		});
	});
	
	describe("#updateSchema()", function () {
		it("should set last client version", function* () {
			var sql = "REPLACE INTO settings (setting, key, value) VALUES ('client', 'lastVersion', ?)";
			yield Zotero.DB.queryAsync(sql, "5.0old");
			
			yield Zotero.Schema.updateSchema();
			
			var sql = "SELECT value FROM settings WHERE setting='client' AND key='lastVersion'";
			var lastVersion = yield Zotero.DB.valueQueryAsync(sql);
			yield assert.eventually.equal(Zotero.DB.valueQueryAsync(sql), Zotero.version);
		});
	});
	
	describe("Global Schema", function () {
		var schemaJSON, schema;
		
		before(async function () {
			schemaJSON = await Zotero.File.getResourceAsync('resource://zotero/schema/global/schema.json');
		});
		
		beforeEach(async function () {
			await resetDB({
				thisArg: this,
				skipBundledFiles: true
			});
			schema = JSON.parse(schemaJSON);
		});
		
		after(async function() {
			await resetDB({
				thisArg: this,
				skipBundledFiles: true
			});
		});
		
		describe("#migrateExtraFields()", function () {
			it("should add a new field and migrate values from Extra", async function () {
				var item = await createDataObject('item', { itemType: 'book' });
				item.setField('numPages', "10");
				item.setField('extra', 'Foo Bar: This is a value.\nnumber-of-pages: 11\nThis is another line.');
				item.synced = true;
				await item.saveTx();
				
				schema.version++;
				schema.itemTypes.find(x => x.itemType == 'book').fields.splice(0, 1, { field: 'fooBar' })
				var newLocales = {};
				Object.keys(schema.locales).forEach((locale) => {
					var o = schema.locales[locale];
					o.fields.fooBar = 'Foo Bar';
					newLocales[locale] = o;
				});
				await Zotero.Schema._updateGlobalSchemaForTest(schema);
				await Zotero.Schema.migrateExtraFields();
				
				assert.isNumber(Zotero.ItemFields.getID('fooBar'));
				assert.equal(Zotero.ItemFields.getLocalizedString('fooBar'), 'Foo Bar');
				assert.equal(item.getField('fooBar'), 'This is a value.');
				// Existing fields shouldn't be overwritten and should be left in Extra
				assert.equal(item.getField('numPages'), '10');
				assert.equal(item.getField('extra'), 'number-of-pages: 11\nThis is another line.');
				assert.isFalse(item.synced);
			});
			
			it("should migrate creator", async function () {
				var item = await createDataObject('item', { itemType: 'book' });
				item.setCreators([
					{
						firstName: 'Abc',
						lastName: 'Def',
						creatorType: 'author',
						fieldMode: 0
					}
				]);
				item.setField('extra', 'editor: Last || First\nFoo: Bar');
				item.synced = true;
				await item.saveTx();
				
				schema.version++;
				schema.itemTypes.find(x => x.itemType == 'book').fields.splice(0, 1, { field: 'fooBar' })
				var newLocales = {};
				Object.keys(schema.locales).forEach((locale) => {
					var o = schema.locales[locale];
					o.fields.fooBar = 'Foo Bar';
					newLocales[locale] = o;
				});
				await Zotero.Schema._updateGlobalSchemaForTest(schema);
				await Zotero.Schema.migrateExtraFields();
				
				var creators = item.getCreators();
				assert.lengthOf(creators, 2);
				assert.propertyVal(creators[0], 'firstName', 'Abc');
				assert.propertyVal(creators[0], 'lastName', 'Def');
				assert.propertyVal(creators[0], 'creatorTypeID', Zotero.CreatorTypes.getID('author'));
				assert.propertyVal(creators[1], 'firstName', 'First');
				assert.propertyVal(creators[1], 'lastName', 'Last');
				assert.propertyVal(creators[1], 'creatorTypeID', Zotero.CreatorTypes.getID('editor'));
				assert.equal(item.getField('extra'), 'Foo: Bar');
				assert.isFalse(item.synced);
			});
		});
	});
	
	
	describe("#integrityCheck()", function () {
		before(function* () {
			yield resetDB({
				thisArg: this,
				skipBundledFiles: true
			});
		})
		
		it("should repair a foreign key violation", function* () {
			yield assert.eventually.isTrue(Zotero.Schema.integrityCheck());
			
			yield Zotero.DB.queryAsync("PRAGMA foreign_keys = OFF");
			yield Zotero.DB.queryAsync("INSERT INTO itemTags VALUES (1234,1234,0)");
			yield Zotero.DB.queryAsync("PRAGMA foreign_keys = ON");
			
			yield assert.eventually.isFalse(Zotero.Schema.integrityCheck());
			yield assert.eventually.isTrue(Zotero.Schema.integrityCheck(true));
			yield assert.eventually.isTrue(Zotero.Schema.integrityCheck());
		})
		
		it("should repair invalid nesting between two collections", async function () {
			var c1 = await createDataObject('collection');
			var c2 = await createDataObject('collection', { parentID: c1.id });
			await Zotero.DB.queryAsync(
				"UPDATE collections SET parentCollectionID=? WHERE collectionID=?",
				[c2.id, c1.id]
			);
			
			await assert.isFalse(await Zotero.Schema.integrityCheck());
			await assert.isTrue(await Zotero.Schema.integrityCheck(true));
			await assert.isTrue(await Zotero.Schema.integrityCheck());
		});
		
		it("should repair invalid nesting between three collections", async function () {
			var c1 = await createDataObject('collection');
			var c2 = await createDataObject('collection', { parentID: c1.id });
			var c3 = await createDataObject('collection', { parentID: c2.id });
			await Zotero.DB.queryAsync(
				"UPDATE collections SET parentCollectionID=? WHERE collectionID=?",
				[c3.id, c2.id]
			);
			
			await assert.isFalse(await Zotero.Schema.integrityCheck());
			await assert.isTrue(await Zotero.Schema.integrityCheck(true));
			await assert.isTrue(await Zotero.Schema.integrityCheck());
		});
	})
})
