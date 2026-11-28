import SwiftUI
import PhotosUI

/// 新建 / 编辑账号（传 nil = 新建）。
///
/// 复刻 Web 版 `src/app/accounts.js` 的 `sheet-account`：
///   - 头像预览 + 相册选图（`ImageTools.avatarDataURL` 正方裁剪 128px 压缩）+ 移除头像；
///   - 昵称必填，手机号与抖音账号选填；
///   - 标识色板 8 色，选中打勾并显示色名；
///   - 保存 / 删除（删除后其名下订单变为「未指定」）。
struct AccountFormView: View {
    let account: Account?
    var onSaved: (() -> Void)?

    @EnvironmentObject private var model: AppModel
    @Environment(\.dismiss) private var dismiss

    @State private var name: String
    @State private var phone: String
    @State private var douyin: String
    @State private var colorIndex: Int
    @State private var avatar: String?
    @State private var pickerItem: PhotosPickerItem?
    @State private var errorText: String?
    @State private var showDeleteConfirm = false
    /// 对外登记等级（Lv.5 / Lv.6 / Lv.7）：只用于对外登记，不参与勋章判定。
    @State private var level: AccountLevel
    /// 新建账号的默认标识色是否已按账号数取过（避免覆盖用户手选）。
    @State private var didApplyDefaultColor = false

    private var isEditing: Bool { account != nil }

    init(account: Account?, onSaved: (() -> Void)? = nil) {
        self.account = account
        self.onSaved = onSaved
        _name = State(initialValue: account?.name ?? "")
        _phone = State(initialValue: account?.phone ?? "")
        _douyin = State(initialValue: account?.douyin ?? "")
        _colorIndex = State(initialValue: account?.color ?? 0)
        _avatar = State(initialValue: account?.avatar)
        // 旧账号没有等级字段时按 Lv.5 兜底（与混合版 accLevel 同口径）。
        _level = State(initialValue: account?.level.flatMap(AccountLevel.init(rawValue:)) ?? AccountLevel.standard)
    }

    var body: some View {
        ZStack {
            ScreenBackground()
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    header
                    VStack(alignment: .leading, spacing: 0) {
                        avatarBlock
                        sectionTitle("基本资料")
                        AccountFormRow(label: "昵称 *") {
                            TextField("如：饿了才要吃饱饱", text: $name)
                                .multilineTextAlignment(.trailing)
                                .accessibilityIdentifier("account.field.name")
                        }
                        AccountFormRow(label: "手机号") {
                            TextField("13800006678", text: $phone)
                                .keyboardType(.phonePad)
                                .multilineTextAlignment(.trailing)
                                .accessibilityIdentifier("account.field.phone")
                        }
                        AccountFormRow(label: "抖音账号") {
                            TextField("抖音号或主页链接", text: $douyin)
                                .multilineTextAlignment(.trailing)
                                .accessibilityIdentifier("account.field.douyin")
                        }
                        AccountFormRow(label: "对外等级") {
                            levelPicker
                        }
                        sectionTitle("账号标识")
                        Text("用颜色快速区分不同账号，列表与小标会同步显示。")
                            .font(Theme.body(10.5))
                            .foregroundStyle(Theme.sub)
                            .fixedSize(horizontal: false, vertical: true)
                            .padding(.horizontal, 2)
                        palette
                        paletteName
                        if let errorText {
                            Text(errorText)
                                .font(Theme.body(11.5))
                                .foregroundStyle(Theme.red)
                                .padding(.top, 9)
                        }
                        PrimaryButton(title: isEditing ? "保存账号" : "添加账号") {
                            save()
                        }
                        .accessibilityIdentifier("account.save")
                        .padding(.top, 18)
                        if isEditing {
                            GhostButton(title: "删除账号", systemImage: "trash", tint: Theme.red) {
                                showDeleteConfirm = true
                            }
                            .padding(.top, 9)
                        }
                    }
                    .padding(.horizontal, 20)
                    .padding(.bottom, 34)
                }
            }
        }
        // 弹层自己的提示条宿主：这一层是 sheet，根层的提示条会被盖住。
        .toastHost()
        .alert("删除账号", isPresented: $showDeleteConfirm) {
            Button("取消", role: .cancel) {}
            Button("删除", role: .destructive) { delete() }
        } message: {
            Text(deleteMessage)
        }
        .onChange(of: pickerItem) { _, item in
            guard let item else { return }
            loadAvatar(from: item)
        }
        .onAppear {
            // 新建账号的默认标识色：按已有账号数取色（与 Web 版 openAccount 同口径）。
            if account == nil && !didApplyDefaultColor {
                didApplyDefaultColor = true
                colorIndex = model.accounts.count % AccountPalette.swatches.count
            }
        }
    }

    // MARK: - 顶栏

    private var header: some View {
        HStack(alignment: .center, spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                Text(isEditing ? "编辑账号" : "新建账号")
                    .font(Theme.display(20))
                    .foregroundStyle(Theme.ink)
            }
            Spacer(minLength: 0)
            IconButton(systemName: "xmark", accessibility: "关闭") {
                dismiss()
            }
        }
        .padding(.horizontal, 20)
        .padding(.top, 16)
        .padding(.bottom, 8)
        // 顶栏高度上报给提示条：提示条落在标题下方。
        .toastTopAnchor()
    }

    // MARK: - 头像

    private var avatarBlock: some View {
        HStack(spacing: 15) {
            avatarPreview
            VStack(alignment: .leading, spacing: 0) {
                HStack(spacing: 9) {
                    PhotosPicker(selection: $pickerItem, matching: .images, photoLibrary: .shared()) {
                        Text("从相册选图")
                            .font(Theme.body(12.5, weight: .semibold))
                            .foregroundStyle(Theme.brandInk)
                            .padding(.horizontal, 13)
                            .padding(.vertical, 9)
                            .background(Theme.brandSoft, in: RoundedRectangle(cornerRadius: 13, style: .continuous))
                    }
                    Button {
                        avatar = nil
                    } label: {
                        Text("移除头像")
                            .font(Theme.body(12.5, weight: .semibold))
                            .foregroundStyle(Theme.ink2)
                            .padding(.horizontal, 13)
                            .padding(.vertical, 9)
                            .background(Theme.paperDeep.opacity(0.8), in: RoundedRectangle(cornerRadius: 13, style: .continuous))
                    }
                    .buttonStyle(.plain)
                    .disabled(avatar == nil)
                    .opacity(avatar == nil ? 0.45 : 1)
                }
                Text("自动裁圆压缩，仅存本机")
                    .font(Theme.body(10.5))
                    .foregroundStyle(Theme.sub)
                    .padding(.top, 7)
            }
            Spacer(minLength: 0)
        }
        .padding(.top, 4)
        .padding(.bottom, 6)
    }

    /// 头像预览：圆形裁切（数据本身是 128×128 正方裁剪后的 dataURL）。
    private var avatarPreview: some View {
        let swatch = AccountPalette.swatch(colorIndex)
        return Group {
            if let avatar, let image = ImageTools.image(fromDataURL: avatar) {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFill()
            } else {
                Text(String(name.trimmingCharacters(in: .whitespaces).prefix(1)))
                    .font(Theme.display(30))
                    .foregroundStyle(swatch.ink)
            }
        }
        .frame(width: 96, height: 96)
        .background(swatch.background)
        .clipShape(Circle())
        .overlay(Circle().stroke(Theme.line, lineWidth: 1))
    }

    /// 选完图 → 压缩成头像 dataURL。
    private func loadAvatar(from item: PhotosPickerItem) {
        Task {
            guard let data = try? await item.loadTransferable(type: Data.self),
                  let image = UIImage(data: data),
                  let encoded = ImageTools.avatarDataURL(from: image) else {
                model.showToast("这张图不能用，换一张试试")
                return
            }
            await MainActor.run {
                avatar = encoded
            }
        }
    }

    // MARK: - 色板

    private var palette: some View {
        HStack(spacing: 10) {
            ForEach(Array(AccountPalette.swatches.enumerated()), id: \.offset) { index, swatch in
                Button {
                    colorIndex = index
                } label: {
                    ZStack {
                        Circle()
                            .fill(swatch.ink)
                        if colorIndex == index {
                            Image(systemName: "checkmark")
                                .font(Theme.body(12, weight: .heavy))
                                .foregroundStyle(.white)
                        }
                    }
                    .frame(maxWidth: .infinity)
                    .aspectRatio(1, contentMode: .fit)
                    .overlay {
                        if colorIndex == index {
                            Circle().stroke(Theme.ink, lineWidth: 2)
                        }
                    }
                    .overlay {
                        Circle().stroke(Color.black.opacity(0.06), lineWidth: 1)
                    }
                }
                .buttonStyle(.plain)
                .accessibilityLabel(swatch.name)
            }
        }
        .padding(.vertical, 12)
    }

    private var paletteName: some View {
        let swatch = AccountPalette.swatch(colorIndex)
        return Text("当前标识色：\(swatch.name) · 列表色条与行内小标同步跟随")
            .font(Theme.body(11))
            .foregroundStyle(Theme.sub)
    }

    // MARK: - 对外等级

    /// 对外登记等级：Lv.5 / Lv.6 / Lv.7。
    ///
    /// 只用于对外登记（报名表、服务商对接），不参与勋章判定。
    private var levelPicker: some View {
        HStack(spacing: 6) {
            ForEach(AccountLevel.allCases) { item in
                Button {
                    level = item
                } label: {
                    Text(item.title)
                        .font(Theme.body(12, weight: .bold))
                        .foregroundStyle(item == level ? Theme.brandInk : Theme.ink2)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 7)
                        .background(item == level ? Theme.brandSoft : Theme.paperDeep, in: Capsule())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("对外等级 \(item.title)")
                .accessibilityIdentifier("account.level.\(item.rawValue)")
            }
            Spacer(minLength: 0)
        }
    }

    // MARK: - 保存 / 删除

    private func save() {
        let trimmedName = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedName.isEmpty else {
            errorText = "请填写昵称"
            return
        }
        errorText = nil
        let target = Account(id: account?.id ?? model.nextAccountId(),
                             name: trimmedName,
                             phone: phone.trimmingCharacters(in: .whitespacesAndNewlines),
                             douyin: douyin.trimmingCharacters(in: .whitespacesAndNewlines),
                             color: colorIndex % AccountPalette.swatches.count,
                             avatar: avatar,
                             createdAt: account?.createdAt ?? Logic.nowString(),
                             level: level.rawValue)
        Task {
            await model.upsertAccount(target)
            model.showToast(isEditing ? "已保存账号" : "已添加账号")
            dismiss()
            onSaved?()
        }
    }

    private var deleteMessage: String {
        guard let account else { return "" }
        let count = model.orders.filter { $0.accountId == account.id }.count
        return "删除「\(account.name)」？其名下 \(count) 笔订单将变为「未指定」，可再改挂。"
    }

    private func delete() {
        guard let account else { return }
        Task {
            await model.deleteAccount(account.id)
            model.showToast("已删除账号")
            dismiss()
            onSaved?()
        }
    }

    private func sectionTitle(_ text: String) -> some View {
        HStack(spacing: 8) {
            Text(text)
                .font(Theme.body(10, weight: .heavy))
                .tracking(1.2)
                .foregroundStyle(Theme.sub)
            Rectangle()
                .fill(Theme.line)
                .frame(height: 1)
        }
        .padding(.top, 18)
        .padding(.bottom, 4)
    }
}

// MARK: - 表单行

/// 表单行：左标签右输入（对应 Web 版 .frow）。
private struct AccountFormRow<Content: View>: View {
    let label: String
    @ViewBuilder var content: Content

    var body: some View {
        HStack(spacing: 10) {
            Text(label)
                .font(Theme.body(13, weight: .semibold))
                .foregroundStyle(Theme.ink)
                .frame(width: 76, alignment: .leading)
            content
        }
        .padding(.vertical, 6)
        .frame(minHeight: 52)
        .overlay(alignment: .bottom) {
            Rectangle().fill(Theme.line).frame(height: 1)
        }
    }
}
