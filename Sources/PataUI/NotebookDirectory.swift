import SwiftUI
import PataCore

enum NotebookLocation: Hashable {
    case all
    case unfiled
    case notebook(String)

    var title: String {
        switch self {
        case .all: return "全部笔记"
        case .unfiled: return "未分类"
        case .notebook(let name): return name
        }
    }

    var notebookName: String? {
        if case .notebook(let name) = self { return name }
        return nil
    }

    func contains(_ note: Note) -> Bool {
        guard !note.draft else { return false }
        switch self {
        case .all: return true
        case .unfiled: return note.notebook?.isEmpty != false
        case .notebook(let name): return note.notebook?.caseInsensitiveCompare(name) == .orderedSame
        }
    }
}

struct NotebookDirectory<NoteRow: View>: View {
    let notebooks: [String]
    let notes: [Note]
    let location: NotebookLocation
    let selectedNoteID: String?
    @Binding var expanded: Set<String>
    let onBrowse: (NotebookLocation) -> Bool
    let onCreate: () -> Void
    let onRename: (String) -> Void
    let onDelete: (String) -> Void
    let onCreateNote: (String) -> Void
    let noteRow: (Note) -> NoteRow

    var body: some View {
        VStack(spacing: 2) {
            locationRow(.all, icon: "books.vertical") { _ = onBrowse(.all) }
            locationRow(.unfiled, icon: "tray", expanded: expanded.contains("")) {
                guard onBrowse(.unfiled) else { return }
                if expanded.contains("") { expanded.remove("") } else { expanded.insert("") }
            }
            if expanded.contains("") {
                ForEach(notes.filter(NotebookLocation.unfiled.contains)) { note in
                    noteRow(note).padding(.leading, 22)
                }
            }

            HStack {
                Text("笔记本").font(.system(size: 12, weight: .semibold)).foregroundStyle(.secondary)
                Spacer()
                Button(action: onCreate) { Image(systemName: "folder.badge.plus").frame(width: 24, height: 24) }
                    .buttonStyle(.plain)
                    .help("新建笔记本")
                    .accessibilityLabel("新建笔记本")
            }
            .padding(.horizontal, 8)
            .padding(.top, 12)
            .padding(.bottom, 4)

            ForEach(notebooks, id: \.self) { name in
                let target = NotebookLocation.notebook(name)
                let isExpanded = expanded.contains(name)
                locationRow(target, icon: isExpanded ? "folder.fill" : "folder", expanded: isExpanded) {
                    guard onBrowse(target) else { return }
                    if isExpanded { expanded.remove(name) } else { expanded.insert(name) }
                }
                .contextMenu {
                    Button("新建笔记") { onCreateNote(name) }
                    Divider()
                    Button("重命名…") { onRename(name) }
                    Button("删除笔记本…", role: .destructive) { onDelete(name) }
                }
                if isExpanded {
                    let members = notes.filter(target.contains)
                    if members.isEmpty {
                        Text("暂无笔记")
                            .font(.system(size: 12)).foregroundStyle(.secondary)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.leading, 38).padding(.vertical, 5)
                    }
                    ForEach(members) { note in noteRow(note).padding(.leading, 22) }
                }
            }
        }
    }

    private func locationRow(_ target: NotebookLocation, icon: String, expanded: Bool? = nil, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 6) {
                if let expanded {
                    Image(systemName: expanded ? "chevron.down" : "chevron.right")
                        .font(.system(size: 9, weight: .semibold)).frame(width: 10)
                }
                Image(systemName: icon).font(.system(size: 12)).frame(width: 16)
                Text(target.title).lineLimit(1)
                Spacer(minLength: 4)
                Text("\(notes.filter(target.contains).count)").font(.system(size: 11, design: .monospaced)).foregroundStyle(.secondary)
            }
            .font(.system(size: 13, weight: target == location && selectedNoteID == nil ? .medium : .regular))
            .padding(.horizontal, 8).padding(.vertical, 7)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(RoundedRectangle(cornerRadius: 6).fill(target == location && selectedNoteID == nil ? Color.stoneSelectedBg : .clear))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .help(target.title)
    }
}

struct NotebookOverview: View {
    let location: NotebookLocation
    let notes: [Note]
    let onSelect: (Note) -> Void
    let onCreateNote: () -> Void
    let onRename: (String) -> Void
    let onDelete: (String) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack(alignment: .firstTextBaseline) {
                Label(location.title, systemImage: "folder").font(.system(size: 22, weight: .semibold))
                Spacer()
                Button("新建笔记", action: onCreateNote)
                if let name = location.notebookName {
                    Menu {
                        Button("重命名…") { onRename(name) }
                        Button("删除笔记本…", role: .destructive) { onDelete(name) }
                    } label: { Image(systemName: "ellipsis").frame(width: 24, height: 24) }
                    .menuStyle(.borderlessButton).fixedSize().accessibilityLabel("笔记本操作")
                }
            }
            Text("\(notes.count) 篇笔记").font(.system(size: 12)).foregroundStyle(.secondary)
            if notes.isEmpty {
                Spacer()
                VStack(spacing: 12) {
                    Image(systemName: "doc.text").font(.system(size: 28)).foregroundStyle(.tertiary)
                    Text("这个笔记本还没有笔记").foregroundStyle(.secondary)
                    Button("新建笔记", action: onCreateNote)
                }.frame(maxWidth: .infinity)
                Spacer()
            } else {
                ScrollView {
                    LazyVStack(spacing: 0) {
                        ForEach(notes) { note in
                            Button { onSelect(note) } label: {
                                HStack(spacing: 10) {
                                    Image(systemName: note.audioTranscript ? "waveform" : "doc.text").foregroundStyle(.secondary)
                                    Text(note.title.isEmpty ? "未命名笔记" : note.title).lineLimit(2)
                                    Spacer()
                                    if location == .all {
                                        Text(note.notebook ?? "未分类").font(.system(size: 12)).foregroundStyle(.secondary).lineLimit(1)
                                    }
                                }
                                .padding(.vertical, 13)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .contentShape(Rectangle())
                            }.buttonStyle(.plain)
                            Divider()
                        }
                    }
                }
            }
        }.padding(24).frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

struct NotebookNameSheet: View {
    let originalName: String?
    let onSave: (String) -> String?
    @Environment(\.dismiss) private var dismiss
    @State private var name: String
    @State private var error: String?
    @FocusState private var isFocused: Bool

    init(originalName: String?, onSave: @escaping (String) -> String?) {
        self.originalName = originalName
        self.onSave = onSave
        _name = State(initialValue: originalName ?? "")
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text(originalName == nil ? "新建笔记本" : "重命名笔记本").font(.headline)
            TextField("笔记本名称", text: $name).textFieldStyle(.roundedBorder).focused($isFocused)
            if let error { Text(error).font(.callout).foregroundStyle(.red).textSelection(.enabled) }
            HStack {
                Spacer()
                Button("取消") { dismiss() }.keyboardShortcut(.cancelAction)
                Button("保存") {
                    error = onSave(name)
                    if error == nil { dismiss() }
                }.keyboardShortcut(.defaultAction)
            }
        }.padding(24).frame(width: 360).onAppear { isFocused = true }
    }
}
