import Foundation

extension Vault {
    private struct NotebookCatalog: Codable {
        var notebooks: [String]
    }

    /// Note Frontmatter 保存归属；目录文件另行保留空笔记本。
    public func listNotebooks() throws -> [String] {
        mutationLock.lock()
        defer { mutationLock.unlock() }
        let (catalog, _) = try readNotebookCatalog()
        return notebookNames(catalog.notebooks + index.listNotes().filter { !$0.draft }.compactMap(\.notebook))
    }

    public func createNotebook(name: String) throws {
        mutationLock.lock()
        defer { mutationLock.unlock() }
        let name = try checkedNotebookName(name)
        let (catalog, baseline) = try readNotebookCatalog()
        let names = try listNotebooks()
        guard !names.contains(where: { $0.caseInsensitiveCompare(name) == .orderedSame }) else {
            throw SchemaError.validationError(field: "notebook", reason: "已存在同名笔记本")
        }
        try writeNotebookCatalog(notebookNames(catalog.notebooks + names + [name]), baseline: baseline)
    }

    @discardableResult
    public func moveNote(id: String, toNotebook name: String?) throws -> Note {
        mutationLock.lock()
        defer { mutationLock.unlock() }
        guard var note = index.getNote(id), !note.draft else {
            throw SchemaError.validationError(field: "id", reason: "请选择正式笔记")
        }
        if let name {
            guard let existing = try listNotebooks().first(where: { $0.caseInsensitiveCompare(name) == .orderedSame }) else {
                throw SchemaError.validationError(field: "notebook", reason: "笔记本不存在")
            }
            note.notebook = existing
        } else {
            note.notebook = nil
        }
        return try updateNote(note)
    }

    public func renameNotebook(name: String, newName: String) throws {
        mutationLock.lock()
        defer { mutationLock.unlock() }
        let newName = try checkedNotebookName(newName)
        let (_, baseline) = try readNotebookCatalog()
        let names = try listNotebooks()
        guard names.contains(where: { $0.caseInsensitiveCompare(name) == .orderedSame }) else {
            throw SchemaError.validationError(field: "notebook", reason: "笔记本不存在")
        }
        guard !names.contains(where: { $0.caseInsensitiveCompare(name) != .orderedSame && $0.caseInsensitiveCompare(newName) == .orderedSame }) else {
            throw SchemaError.validationError(field: "notebook", reason: "已存在同名笔记本")
        }
        try updateNotebookMembership(from: name, to: newName)
        try writeNotebookCatalog(notebookNames(names.map { $0.caseInsensitiveCompare(name) == .orderedSame ? newName : $0 }), baseline: baseline)
    }

    /// 删除笔记本只清除归属，保留笔记文件和附件。
    public func deleteNotebook(name: String) throws {
        mutationLock.lock()
        defer { mutationLock.unlock() }
        let (_, baseline) = try readNotebookCatalog()
        let names = try listNotebooks()
        try updateNotebookMembership(from: name, to: nil)
        try writeNotebookCatalog(names.filter { $0.caseInsensitiveCompare(name) != .orderedSame }, baseline: baseline)
    }

    private func updateNotebookMembership(from name: String, to newName: String?) throws {
        for var note in index.listNotes() where !note.draft && note.notebook?.caseInsensitiveCompare(name) == .orderedSame {
            note.notebook = newName
            do {
                _ = try updateNote(note)
            } catch {
                throw SchemaError.validationError(field: "notebook", reason: "笔记「\(note.title)」更新失败。已完成的修改已保留，其余笔记仍在原位置，可重试。\(error.localizedDescription)")
            }
        }
    }

    private func checkedNotebookName(_ value: String) throws -> String {
        let name = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty, name.count <= 80, !name.contains(where: { $0.isNewline }),
              !name.contains("/"), !name.contains("\\"), !name.contains("\0"),
              name != "全部笔记", name != "未分类", name != "草稿" else {
            throw SchemaError.validationError(field: "notebook", reason: "请输入 1–80 字的单层笔记本名称，不能使用保留名称或路径分隔符")
        }
        return name
    }

    private func notebookNames(_ values: [String]) -> [String] {
        var seen = Set<String>()
        return values.compactMap { value in
            let name = value.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !name.isEmpty, seen.insert(name.lowercased()).inserted else { return nil }
            return name
        }.sorted { $0.localizedStandardCompare($1) == .orderedAscending }
    }

    private func notebookCatalogPath() throws -> String {
        try Safety.safeResolveVaultPath(vaultRoot: rootPath, targetPath: ".pata/notebooks.json").absPath
    }

    private func readNotebookCatalog() throws -> (NotebookCatalog, FileBaseline?) {
        let path = try notebookCatalogPath()
        guard FileManager.default.fileExists(atPath: path) else { return (NotebookCatalog(notebooks: []), nil) }
        let (baseline, data) = try Safety.readBaseline(absPath: path)
        return (try JSONDecoder().decode(NotebookCatalog.self, from: data), baseline)
    }

    private func writeNotebookCatalog(_ names: [String], baseline: FileBaseline?) throws {
        let path = try notebookCatalogPath()
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        try Safety.safeWrite(targetPath: path, data: encoder.encode(NotebookCatalog(notebooks: names)), baseline: baseline, tracker: tracker)
        onEvent?(VaultEvent(op: "update", path: path, type: .note))
    }
}
