// 'vscode' 模块包含 VS Code 扩展性 API
// 导入模块并在下面的代码中使用别名 vscode 引用它
const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const pdf = require('pdf-parse');
const EPub = require('epub2').EPub;

/**
 * 存储管理器类 - 负责数据持久化
 */
class StorageManager {
	constructor(context) {
		this._context = context;
	}

	/**
	 * 保存文件列表
	 */
	async saveFiles(files) {
		try {
			// 序列化文件列表，只保存必要信息
			const serializedFiles = files.map(file => ({
				id: file.id,
				name: file.name,
				type: file.type,
				path: file.path || '',
				fullText: file.type === '粘贴' ? file.fullText : '',  // 只保存粘贴内容的文本
				addedTime: file.addedTime || Date.now(),
				status: file.status || 'active',
				// 保存阅读位置信息
				lastChapter: file.lastChapter ?? null,
				lastScrollOffset: file.lastScrollOffset ?? 0,
				lastReadTime: file.lastReadTime ?? null
			}));
			
			await this._context.globalState.update('thief-reader.files', serializedFiles);
		} catch (error) {
			console.error('保存文件列表失败:', error);
		}
	}

	/**
	 * 加载文件列表
	 */
	async loadFiles() {
		try {
			const files = await this._context.globalState.get('thief-reader.files');
			return files || [];
		} catch (error) {
			console.error('加载文件列表失败:', error);
			return [];
		}
	}

	/**
	 * 保存阅读状态
	 */
	async saveReadingState(state) {
		try {
			await this._context.globalState.update('thief-reader.readingState', {
				currentFileId: state.currentFileId,
				currentChapter: state.currentChapter,
				scrollOffset: state.scrollOffset,
				lastSaveTime: Date.now()
			});
		} catch (error) {
			console.error('保存阅读状态失败:', error);
		}
	}

	/**
	 * 加载阅读状态
	 */
	async loadReadingState() {
		try {
			const state = await this._context.globalState.get('thief-reader.readingState');
			return state || null;
		} catch (error) {
			console.error('加载阅读状态失败:', error);
			return null;
		}
	}

	/**
	 * 清空所有存储数据
	 */
	async clearAll() {
		try {
			await this._context.globalState.update('thief-reader.files', undefined);
			await this._context.globalState.update('thief-reader.readingState', undefined);
		} catch (error) {
			console.error('清空数据失败:', error);
		}
	}
}

/**
 * ThiefReader WebView 提供者类
 */
class ThiefReaderWebviewProvider {
	constructor(context) {
		this._context = context;
		this._pdfFiles = []; // 存储加载的PDF文件信息
		this._currentPdf = null; // 当前选中的PDF
		this._currentChapter = null; // 当前选中的章节
		this._currentPage = 0; // 当前页码
		this._scrollOffset = 0; // 文字滑动偏移量
		this._statusBarItem = null; // 状态栏项目
		this._opacity = 100; // 状态栏透明度，默认100%
		this._statusBarVisible = true; // 状态栏文字显示状态，默认显示
		this._storageManager = new StorageManager(context); // 存储管理器
		this._saveDebounceTimer = null; // 防抖定时器
		this._isRestoring = false; // 是否正在恢复数据
		this._loadOpacity(); // 从配置中加载透明度
		this._initStatusBar();
		this._restoreData(); // 恢复数据
	}

	/**
	 * 初始化状态栏
	 */
	_initStatusBar() {
		this._statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
		this._statusBarItem.text = "thief-reader: 准备就绪";
		this._statusBarItem.tooltip = '使用 Alt + 方向键滚动文字';
		this._statusBarItem.show();
		this._context.subscriptions.push(this._statusBarItem);
	}

	/**
	 * 恢复数据 - 从存储中恢复文件列表和阅读状态
	 */
	async _restoreData() {
		try {
			this._isRestoring = true;
			
			// 加载保存的文件列表
			const savedFiles = await this._storageManager.loadFiles();
			
			// 第一次安装或没有保存的数据
			if (!savedFiles || savedFiles.length === 0) {
				this._statusBarItem.text = "thief-reader: 准备就绪";
				this._isRestoring = false;
				return;
			}
			
			// 有数据需要恢复时才显示恢复中的提示
			this._statusBarItem.text = "thief-reader: 正在恢复数据...";
			
			const restoredFiles = [];
			const failedFiles = [];
			
			// 遍历恢复每个文件
			for (const savedFile of savedFiles) {
				if (savedFile.type === '粘贴') {
					// 粘贴内容直接恢复
					const chapters = this._extractChaptersWithFallback(savedFile.fullText);
					restoredFiles.push({
						id: savedFile.id,
						name: savedFile.name,
						path: '',
						type: '粘贴',
						chapters: chapters,
						fullText: savedFile.fullText,
						pages: chapters.length,
						status: 'active',
						// 恢复阅读位置
						lastChapter: savedFile.lastChapter ?? null,
						lastScrollOffset: savedFile.lastScrollOffset ?? 0,
						lastReadTime: savedFile.lastReadTime ?? null
					});
				} else {
					// 本地文件需要检查和重新加载
					if (!savedFile.path || !fs.existsSync(savedFile.path)) {
						// 文件不存在
						restoredFiles.push({
							id: savedFile.id,
							name: savedFile.name,
							path: savedFile.path,
							type: savedFile.type,
							chapters: [],
							fullText: '',
							pages: 0,
							status: 'missing',
							// 保留位置信息（虽然文件不存在）
							lastChapter: savedFile.lastChapter ?? null,
							lastScrollOffset: savedFile.lastScrollOffset ?? 0,
							lastReadTime: savedFile.lastReadTime ?? null
						});
						failedFiles.push({
							name: savedFile.name,
							reason: '文件不存在'
						});
					} else {
						// 文件存在，尝试重新加载
						try {
							const fileUri = vscode.Uri.file(savedFile.path);
							const fileInfo = await this._loadFileQuietly(fileUri, savedFile.id);
							if (fileInfo) {
								// 恢复阅读位置
								fileInfo.lastChapter = savedFile.lastChapter ?? null;
								fileInfo.lastScrollOffset = savedFile.lastScrollOffset ?? 0;
								fileInfo.lastReadTime = savedFile.lastReadTime ?? null;
								
								// 验证章节索引是否有效
								if (fileInfo.lastChapter !== null && fileInfo.lastChapter >= fileInfo.chapters.length) {
									fileInfo.lastChapter = 0;
									fileInfo.lastScrollOffset = 0;
								}
								
								restoredFiles.push(fileInfo);
							}
						} catch (error) {
							// 解析失败
							restoredFiles.push({
								id: savedFile.id,
								name: savedFile.name,
								path: savedFile.path,
								type: savedFile.type,
								chapters: [],
								fullText: '',
								pages: 0,
								status: 'error',
								// 保留位置信息
								lastChapter: savedFile.lastChapter ?? null,
								lastScrollOffset: savedFile.lastScrollOffset ?? 0,
								lastReadTime: savedFile.lastReadTime ?? null
							});
							failedFiles.push({
								name: savedFile.name,
								reason: '文件解析失败: ' + error.message
							});
						}
					}
				}
			}
			
			// 更新文件列表
			this._pdfFiles = restoredFiles;
			
			// 显示恢复结果（只在有文件时显示）
			if (restoredFiles.length > 0) {
				if (failedFiles.length > 0) {
					const message = `恢复了 ${restoredFiles.length} 个文件，其中 ${failedFiles.length} 个加载失败`;
					vscode.window.showWarningMessage(message, '查看详情', '清理失效文件').then(selection => {
						if (selection === '查看详情') {
							const details = failedFiles.map(f => `• ${f.name}: ${f.reason}`).join('\n');
							vscode.window.showInformationMessage(details);
						} else if (selection === '清理失效文件') {
							this._cleanupMissingFiles();
						}
					});
				} else {
					vscode.window.showInformationMessage(`成功恢复 ${restoredFiles.length} 个文件`);
				}
			}
			
			// 恢复阅读位置
			await this._restoreReadingState();
			
			// 刷新界面
			if (this._view) {
				this._refreshView();
			}
			
			this._isRestoring = false;
		} catch (error) {
			console.error('恢复数据失败:', error);
			vscode.window.showErrorMessage('恢复阅读数据失败: ' + error.message);
			this._statusBarItem.text = "thief-reader: 准备就绪";
			this._isRestoring = false;
		}
	}

	/**
	 * 恢复阅读状态
	 */
	async _restoreReadingState() {
		try {
			const state = await this._storageManager.loadReadingState();
			
			if (!state || !state.currentFileId) {
				this._statusBarItem.text = "thief-reader: 准备就绪";
				return;
			}
			
			// 查找文件
			const file = this._pdfFiles.find(f => f.id === state.currentFileId);
			
			if (!file) {
				// 文件已被删除
				this._statusBarItem.text = "thief-reader: 准备就绪";
				return;
			}
			
			if (file.status === 'missing' || file.status === 'error') {
				// 文件不可用
				vscode.window.showWarningMessage(
					`上次阅读的文件 "${file.name}" 无法加载，请重新选择文件`
				);
				this._statusBarItem.text = "thief-reader: 准备就绪";
				return;
			}
			
			// 恢复选择
			this._currentPdf = file;
			
			// 使用文件自己保存的阅读位置
			this._restoreFileReadingPosition(file);
			
			// 显示内容
			if (this._currentChapter !== null && file.chapters && file.chapters.length > 0) {
				const chapter = file.chapters[this._currentChapter];
				this._displayChapterText(chapter);
			} else {
				this._statusBarItem.text = `thief-reader: 已恢复 ${file.name}`;
			}
		} catch (error) {
			console.error('恢复阅读状态失败:', error);
			this._statusBarItem.text = "thief-reader: 准备就绪";
		}
	}

	/**
	 * 静默加载文件（用于恢复数据）
	 */
	async _loadFileQuietly(fileUri, fileId) {
		const filePath = fileUri.fsPath;
		const fileName = path.basename(filePath);
		const fileExtension = path.extname(filePath).toLowerCase();
		
		let fileContent = '';
		let pageCount = 1;
		let chapters = [];
		
		if (fileExtension === '.pdf') {
			const fileBuffer = fs.readFileSync(filePath);
			const pdfData = await pdf(fileBuffer);
			fileContent = pdfData.text;
			pageCount = pdfData.numpages;
			chapters = this._extractChapters(fileContent);
		} else if (fileExtension === '.txt') {
			fileContent = fs.readFileSync(filePath, 'utf8');
			const lineCount = fileContent.split('\n').length;
			pageCount = Math.ceil(lineCount / 50);
			chapters = this._extractChapters(fileContent);
		} else if (fileExtension === '.epub') {
			const epubData = await this._parseEpub(filePath);
			fileContent = epubData.content;
			chapters = epubData.chapters;
			pageCount = chapters.length;
		} else {
			throw new Error(`不支持的文件格式: ${fileExtension}`);
		}
		
		return {
			id: fileId || Date.now().toString(),
			name: fileName,
			path: filePath,
			type: fileExtension === '.pdf' ? 'PDF' : fileExtension === '.txt' ? 'TXT' : 'EPUB',
			chapters: chapters,
			fullText: fileContent,
			pages: pageCount,
			status: 'active'
		};
	}

	/**
	 * 清理缺失和错误的文件
	 */
	_cleanupMissingFiles() {
		const validFiles = this._pdfFiles.filter(
			f => f.status !== 'missing' && f.status !== 'error'
		);
		
		const removedCount = this._pdfFiles.length - validFiles.length;
		this._pdfFiles = validFiles;
		
		// 如果当前文件被清理了，清空选择
		if (this._currentPdf && (this._currentPdf.status === 'missing' || this._currentPdf.status === 'error')) {
			this._currentPdf = null;
			this._currentChapter = null;
			this._scrollOffset = 0;
			this._statusBarItem.text = "thief-reader: 准备就绪";
		}
		
		this._saveCurrentState();
		this._refreshView();
		
		vscode.window.showInformationMessage(`已清理 ${removedCount} 个失效文件`);
	}

	/**
	 * 保存文件的阅读位置
	 */
	_saveFileReadingPosition(fileId) {
		if (!fileId) return;
		
		const file = this._pdfFiles.find(f => f.id === fileId);
		if (!file) return;
		
		// 更新文件的阅读位置
		file.lastChapter = this._currentChapter;
		file.lastScrollOffset = this._scrollOffset;
		file.lastReadTime = Date.now();
	}

	/**
	 * 恢复文件的阅读位置
	 */
	_restoreFileReadingPosition(file) {
		if (!file) return;
		
		// 检查文件是否有保存的位置
		if (file.lastChapter !== null && file.lastChapter !== undefined) {
			// 验证章节索引是否有效
			if (file.chapters && file.lastChapter >= file.chapters.length) {
				// 章节越界，重置到第一章
				this._currentChapter = file.chapters.length > 0 ? 0 : null;
				this._scrollOffset = 0;
				vscode.window.showWarningMessage(
					`文件 "${file.name}" 的阅读位置已失效，已重置到开头`
				);
			} else {
				// 正常恢复
				this._currentChapter = file.lastChapter;
				this._scrollOffset = file.lastScrollOffset || 0;
			}
		} else {
			// 首次打开，从头开始
			this._currentChapter = file.chapters && file.chapters.length > 0 ? 0 : null;
			this._scrollOffset = 0;
		}
	}

	/**
	 * 保存当前状态（带防抖）
	 */
	_saveCurrentState() {
		// 如果正在恢复数据，不保存
		if (this._isRestoring) {
			return;
		}
		
		// 更新当前文件的阅读位置
		if (this._currentPdf) {
			this._saveFileReadingPosition(this._currentPdf.id);
		}
		
		// 清除之前的定时器
		if (this._saveDebounceTimer) {
			clearTimeout(this._saveDebounceTimer);
		}
		
		// 设置新的定时器（500ms 后保存）
		this._saveDebounceTimer = setTimeout(async () => {
			try {
				// 保存文件列表（包含每个文件的阅读位置）
				await this._storageManager.saveFiles(this._pdfFiles);
				
				// 保存当前选中的文件ID
				if (this._currentPdf) {
					await this._storageManager.saveReadingState({
						currentFileId: this._currentPdf.id
					});
				}
			} catch (error) {
				console.error('保存状态失败:', error);
			}
		}, 500);
	}

	/**
	 * 解析 WebView 视图
	 * @param {vscode.WebviewView} webviewView 
	 */
	resolveWebviewView(webviewView) {
		this._view = webviewView;

		// 配置 WebView 选项
		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [this._context.extensionUri]
		};

		// 设置 WebView 的 HTML 内容
		webviewView.webview.html = this._getHtmlContent();

		// 监听来自 WebView 的消息
		webviewView.webview.onDidReceiveMessage(
			async message => {
				switch (message.command) {
					case 'selectPdf':
						await this._selectPdfFile();
						break;
					case 'selectFile':
						await this._selectPdfFromList(message.fileId);
						break;
					case 'selectChapter':
						await this._selectChapter(message.chapterId);
						break;
					case 'removeFile':
						this._removePdfFile(message.fileId);
						break;
					case 'loadPastedContent':
						await this._loadPastedContent(message.content);
						break;
					case 'setOpacity':
						this._setOpacity(message.value);
						break;
					case 'getOpacity':
						this._sendOpacityToView();
						break;
					case 'cleanupMissingFiles':
						this._cleanupMissingFiles();
						break;
				}
			},
			undefined,
			this._context.subscriptions
		);

		// 注册键盘快捷键
		this._registerKeyBindings();
	}

	/**
	 * 获取 WebView 的 HTML 内容
	 */
	_getHtmlContent() {
		const fileListHtml = this._pdfFiles.map(file => {
			let statusIcon = '';
			let statusText = '';
			const isDisabled = file.status === 'missing' || file.status === 'error';
			
			if (file.status === 'missing') {
				statusIcon = '⚠️ ';
				statusText = ' <span style="color: var(--vscode-errorForeground);">(文件不存在)</span>';
			} else if (file.status === 'error') {
				statusIcon = '⚠️ ';
				statusText = ' <span style="color: var(--vscode-errorForeground);">(解析失败)</span>';
			}
			
			return `
				<div class="file-item ${this._currentPdf && this._currentPdf.id === file.id ? 'active' : ''} ${isDisabled ? 'disabled' : ''}" 
				     data-file-id="${file.id}" 
				     onclick="${isDisabled ? '' : `selectFile('${file.id}')`}"
				     style="display: flex; align-items: center; justify-content: space-between;">
					<div class="file-name">${statusIcon}${file.name} <span style="color: var(--vscode-descriptionForeground); font-size: 10px;">[${file.type}]${statusText}</span></div>
					<div class="file-actions">
						<button class="btn-remove" onclick="event.stopPropagation(); removeFile('${file.id}')">删除</button>
					</div>
				</div>
			`;
		}).join('');

		const chapterListHtml = this._currentPdf && this._currentPdf.chapters ? 
			this._currentPdf.chapters.map((chapter, index) => `
				<div class="chapter-item ${this._currentChapter === index ? 'active' : ''}" data-chapter-id="${index}">
					<div class="chapter-title" onclick="selectChapter(${index})">${chapter.title}</div>
				</div>
			`).join('') : '';

		return `<!DOCTYPE html>
		<html lang="zh-CN">
		<head>
			<meta charset="UTF-8">
			<meta name="viewport" content="width=device-width, initial-scale=1.0">
			<title>thief-reader</title>
			<style>
				body {
					font-family: var(--vscode-font-family);
					font-size: var(--vscode-font-size);
					color: var(--vscode-foreground);
					background-color: var(--vscode-editor-background);
					padding: 10px;
					margin: 0;
				}
				.header {
					text-align: center;
					margin-bottom: 20px;
				}
				.title {
					font-size: 20px;
					font-weight: bold;
					color: var(--vscode-textLink-foreground);
					margin-bottom: 10px;
				}
				.section {
					margin-bottom: 20px;
				}
				.section-title {
					font-size: 14px;
					font-weight: bold;
					margin-bottom: 10px;
					color: var(--vscode-textLink-foreground);
					border-bottom: 1px solid var(--vscode-widget-border);
					padding-bottom: 5px;
				}
				.btn-primary {
					background-color: var(--vscode-button-background);
					color: var(--vscode-button-foreground);
					border: none;
					padding: 8px 16px;
					border-radius: 4px;
					cursor: pointer;
					font-size: 12px;
					margin-bottom: 10px;
				}
				.btn-primary:hover {
					background-color: var(--vscode-button-hoverBackground);
				}
				.file-item, .chapter-item {
					padding: 8px;
					margin-bottom: 5px;
					border: 1px solid var(--vscode-widget-border);
					border-radius: 4px;
					cursor: pointer;
					transition: background-color 0.1s;
				}
				.file-item:hover, .chapter-item:hover {
					background-color: var(--vscode-list-hoverBackground);
				}
				.file-item.active, .chapter-item.active {
					background-color: var(--vscode-list-activeSelectionBackground);
					color: var(--vscode-list-activeSelectionForeground);
				}
				.file-item.disabled {
					opacity: 0.6;
					background-color: var(--vscode-input-background);
					cursor: not-allowed;
				}
				.file-item.disabled:hover {
					background-color: var(--vscode-input-background);
				}
				.file-name {
					font-size: 12px;
					flex: 1;
					overflow: hidden;
					text-overflow: ellipsis;
					white-space: nowrap;
					margin-right: 8px;
				}
				.chapter-title {
					font-size: 12px;
					margin-bottom: 5px;
				}
				.file-actions {
					display: flex;
					gap: 5px;
					align-items: center;
				}
				.btn-remove {
					background-color: transparent;
					color: var(--vscode-errorForeground);
					border: 1px solid var(--vscode-errorForeground);
					padding: 2px 8px;
					border-radius: 3px;
					cursor: pointer;
					font-size: 10px;
					transition: all 0.1s;
				}
				.btn-remove:hover {
					background-color: var(--vscode-errorForeground);
					color: var(--vscode-errorForeground--contrast);
				}
				.empty-state {
					text-align: center;
					color: var(--vscode-descriptionForeground);
					font-style: italic;
					padding: 20px;
				}
				.paste-textarea {
					width: 100%;
					min-height: 100px;
					padding: 8px;
					margin-bottom: 10px;
					font-family: var(--vscode-font-family);
					font-size: var(--vscode-font-size);
					color: var(--vscode-foreground);
					background-color: var(--vscode-input-background);
					border: 1px solid var(--vscode-input-border);
					border-radius: 4px;
					resize: vertical;
				}
				.paste-textarea:focus {
					outline: 1px solid var(--vscode-focusBorder);
				}
				.setting-item {
					margin-bottom: 15px;
				}
				.setting-item label {
					display: block;
					margin-bottom: 5px;
					font-size: 12px;
					color: var(--vscode-foreground);
				}
				.opacity-slider {
					width: 100%;
					height: 4px;
					border-radius: 2px;
					background: var(--vscode-scrollbarSlider-background);
					outline: none;
					cursor: pointer;
					border: none;
				}
				.opacity-slider:focus {
					outline: none;
					border: none;
				}
				.opacity-slider::-webkit-slider-thumb {
					-webkit-appearance: none;
					appearance: none;
					width: 12px;
					height: 12px;
					border-radius: 50%;
					background: var(--vscode-button-background);
					cursor: pointer;
					border: none;
					outline: none;
				}
				.opacity-slider::-webkit-slider-thumb:focus {
					outline: none;
					border: none;
				}
				.opacity-slider::-moz-range-thumb {
					width: 12px;
					height: 12px;
					border-radius: 50%;
					background: var(--vscode-button-background);
					cursor: pointer;
					border: none;
					outline: none;
				}
				.opacity-slider::-moz-range-thumb:focus {
					outline: none;
					border: none;
				}
				#opacity-value {
					font-weight: bold;
					color: var(--vscode-textLink-foreground);
				}
				#file-list {
					max-height: 280px; /* 5个文件项的高度 (每项约56px) */
					overflow-y: auto;
					overflow-x: hidden;
				}
				#file-list::-webkit-scrollbar {
					width: 8px;
				}
				#file-list::-webkit-scrollbar-track {
					background: var(--vscode-scrollbarSlider-background);
					border-radius: 4px;
				}
				#file-list::-webkit-scrollbar-thumb {
					background: var(--vscode-scrollbarSlider-hoverBackground);
					border-radius: 4px;
				}
				#file-list::-webkit-scrollbar-thumb:hover {
					background: var(--vscode-scrollbarSlider-activeBackground);
				}
				#chapter-list {
					max-height: 450px; /* 10个章节项的高度 (每项约45px) */
					overflow-y: auto;
					overflow-x: hidden;
				}
				#chapter-list::-webkit-scrollbar {
					width: 8px;
				}
				#chapter-list::-webkit-scrollbar-track {
					background: var(--vscode-scrollbarSlider-background);
					border-radius: 4px;
				}
				#chapter-list::-webkit-scrollbar-thumb {
					background: var(--vscode-scrollbarSlider-hoverBackground);
					border-radius: 4px;
				}
				#chapter-list::-webkit-scrollbar-thumb:hover {
					background: var(--vscode-scrollbarSlider-activeBackground);
				}
			</style>
		</head>
		<body>
			<div class="header">
				<div class="title">📖 thief-reader</div>
			</div>

			<div class="section">
				<div class="section-title">文件管理</div>
				<button class="btn-primary" onclick="selectPdf()">选择文件 (PDF/TXT/EPUB)</button>
				<button class="btn-primary" onclick="cleanupMissingFiles()" style="background-color: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground);">清理失效文件</button>
				<div id="file-list">
					${fileListHtml || '<div class="empty-state">暂无文件，请点击上方按钮选择PDF、TXT或EPUB文件</div>'}
				</div>
			</div>

			<div class="section">
				<div class="section-title">粘贴文本内容</div>
				<textarea id="paste-textarea" class="paste-textarea" placeholder="将文本内容粘贴到这里..."></textarea>
				<button class="btn-primary" onclick="loadPastedContent()">加载粘贴内容</button>
			</div>

			<div class="section">
				<div class="section-title">设置</div>
				<div class="setting-item">
					<label for="opacity-slider">状态栏文字区域透明度: <span id="opacity-value">100</span>%</label>
					<input type="range" id="opacity-slider" class="opacity-slider" min="5" max="100" value="100" step="5" oninput="updateOpacity(this.value)">
				</div>
			</div>

			<div class="section">
				<div class="section-title">章节列表</div>
				<div id="chapter-list">
					${chapterListHtml || '<div class="empty-state">请先选择一个文件或粘贴文本内容</div>'}
				</div>
			</div>

			<script>
				const vscode = acquireVsCodeApi();

				// 页面加载时恢复透明度设置
				window.addEventListener('DOMContentLoaded', () => {
					// 请求当前的透明度设置
					vscode.postMessage({ command: 'getOpacity' });
				});

				// 监听来自扩展的消息
				window.addEventListener('message', event => {
					const message = event.data;
					switch (message.command) {
						case 'setOpacity':
							const slider = document.getElementById('opacity-slider');
							const valueSpan = document.getElementById('opacity-value');
							if (slider && valueSpan) {
								slider.value = message.value;
								valueSpan.textContent = message.value;
							}
							break;
					}
				});

				function selectPdf() {
					vscode.postMessage({ command: 'selectPdf' });
				}

				function selectFile(fileId) {
					vscode.postMessage({ command: 'selectFile', fileId: fileId });
				}

				function removeFile(fileId) {
					vscode.postMessage({ command: 'removeFile', fileId: fileId });
				}

				function selectChapter(chapterId) {
					vscode.postMessage({ command: 'selectChapter', chapterId: chapterId });
				}

				function loadPastedContent() {
					const textarea = document.getElementById('paste-textarea');
					const content = textarea.value.trim();
					
					if (content.length === 0) {
						return;
					}
					
					vscode.postMessage({ 
						command: 'loadPastedContent', 
						content: content 
					});
					
					// 清空文本框
					textarea.value = '';
				}

				function updateOpacity(value) {
					// 更新显示的数值
					document.getElementById('opacity-value').textContent = value;
					
					// 发送到扩展
					vscode.postMessage({ 
						command: 'setOpacity', 
						value: parseInt(value) 
					});
				}

				function cleanupMissingFiles() {
					vscode.postMessage({ command: 'cleanupMissingFiles' });
				}
			</script>
		</body>
		</html>`;
	}

	/**
	 * 选择文件（支持PDF、TXT和EPUB）
	 */
	async _selectPdfFile() {
		try {
			const options = {
				canSelectMany: false,
				openLabel: '选择文件',
				filters: {
					'支持的文件': ['pdf', 'txt', 'epub'],
					'PDF文件': ['pdf'],
					'文本文件': ['txt'],
					'EPUB电子书': ['epub'],
					'所有文件': ['*']
				}
			};

			const fileUri = await vscode.window.showOpenDialog(options);
			if (fileUri && fileUri[0]) {
				await this._loadFile(fileUri[0]);
			}
		} catch (error) {
			vscode.window.showErrorMessage(`选择文件失败: ${error.message}`);
		}
	}

	/**
	 * 加载文件（支持PDF、TXT和EPUB）
	 */
	async _loadFile(fileUri) {
		try {
			const filePath = fileUri.fsPath;
			const fileName = path.basename(filePath);
			const fileExtension = path.extname(filePath).toLowerCase();
			
			this._statusBarItem.text = `thief-reader: 正在解析 ${fileName}...`;
			
			let fileContent = '';
			let pageCount = 1;
			let chapters = [];
			
			if (fileExtension === '.pdf') {
				// 解析PDF文件
				const fileBuffer = fs.readFileSync(filePath);
				const pdfData = await pdf(fileBuffer);
				fileContent = pdfData.text;
				pageCount = pdfData.numpages;
				chapters = this._extractChapters(fileContent);
			} else if (fileExtension === '.txt') {
				// 解析TXT文件
				fileContent = fs.readFileSync(filePath, 'utf8');
				const lineCount = fileContent.split('\n').length;
				pageCount = Math.ceil(lineCount / 50);
				chapters = this._extractChapters(fileContent);
			} else if (fileExtension === '.epub') {
				// 解析EPUB文件
				const epubData = await this._parseEpub(filePath);
				fileContent = epubData.content;
				chapters = epubData.chapters;
				pageCount = chapters.length;
			} else {
				throw new Error(`不支持的文件格式: ${fileExtension}`);
			}
			
			const fileInfo = {
				id: Date.now().toString(),
				name: fileName,
				path: filePath,
				type: fileExtension === '.pdf' ? 'PDF' : fileExtension === '.txt' ? 'TXT' : 'EPUB',
				chapters: chapters,
				fullText: fileContent,
				pages: pageCount,
				status: 'active',
				// 初始化阅读位置
				lastChapter: null,
				lastScrollOffset: 0,
				lastReadTime: null
			};

			// 检查是否已存在相同路径的文件（按路径检查，不是文件名）
			const existingIndex = this._pdfFiles.findIndex(f => f.path === filePath);
			if (existingIndex !== -1) {
				// 找到相同路径的文件，询问用户是否重新加载
				const oldFile = this._pdfFiles[existingIndex];
				const selection = await vscode.window.showInformationMessage(
					`文件 "${fileName}" 已存在，是否重新加载？`,
					{ modal: false },
					'重新加载',
					'取消'
				);
				
				if (selection === '重新加载') {
					// 用户选择重新加载，保留旧的阅读位置和ID
					fileInfo.id = oldFile.id; // 保留原ID
					fileInfo.lastChapter = oldFile.lastChapter;
					fileInfo.lastScrollOffset = oldFile.lastScrollOffset;
					fileInfo.lastReadTime = oldFile.lastReadTime;
					
					// 验证章节索引是否仍然有效
					if (fileInfo.lastChapter !== null && fileInfo.lastChapter >= fileInfo.chapters.length) {
						fileInfo.lastChapter = 0;
						fileInfo.lastScrollOffset = 0;
						vscode.window.showInformationMessage(
							`文件内容已变化，阅读位置已重置到开头`
						);
					}
					
					this._pdfFiles[existingIndex] = fileInfo;
					this._statusBarItem.text = `thief-reader: 已重新加载 ${fileName}`;
					vscode.window.showInformationMessage(`成功重新加载${fileInfo.type}文件: ${fileName}`);
				} else {
					// 用户取消，不做任何操作
					this._statusBarItem.text = `thief-reader: 取消加载`;
					return;
				}
			} else {
				// 新文件，直接添加
				this._pdfFiles.push(fileInfo);
				this._statusBarItem.text = `thief-reader: 已加载 ${fileName}`;
				vscode.window.showInformationMessage(`成功加载${fileInfo.type}文件: ${fileName}`);
			}
			
			// 保存状态
			this._saveCurrentState();
			
			// 刷新界面
			this._refreshView();
		} catch (error) {
			this._statusBarItem.text = "thief-reader: 加载失败";
			vscode.window.showErrorMessage(`加载文件失败: ${error.message}`);
		}
	}

	/**
	 * 解析EPUB文件
	 */
	async _parseEpub(filePath) {
		return new Promise((resolve, reject) => {
			const epub = new EPub(filePath);
			
			epub.on('error', (err) => {
				reject(new Error(`EPUB解析错误: ${err.message}`));
			});
			
			epub.on('end', async () => {
				try {
					const chapters = [];
					let fullContent = '';
					
					// 获取EPUB的章节流
					const flow = epub.flow;
					
					// 遍历所有章节
					for (let i = 0; i < flow.length; i++) {
						const chapterId = flow[i].id;
						
						try {
							// 获取章节内容
							const chapterData = await new Promise((resolveChapter, rejectChapter) => {
								epub.getChapter(chapterId, (error, text) => {
									if (error) {
										rejectChapter(error);
									} else {
										resolveChapter(text);
									}
								});
							});
							
							// 移除HTML标签，提取纯文本
							const textContent = this._stripHtml(chapterData);
							
							if (textContent.trim().length > 0) {
								chapters.push({
									title: flow[i].title || `章节 ${i + 1}`,
									startLine: 0,
									content: textContent.split('\n').filter(line => line.trim().length > 0)
								});
								
								fullContent += textContent + '\n';
							}
						} catch (chapterError) {
							console.warn(`跳过章节 ${chapterId}:`, chapterError);
						}
					}
					
					resolve({
						content: fullContent,
						chapters: chapters.length > 0 ? chapters : [{
							title: '全文内容',
							startLine: 0,
							content: fullContent.split('\n').filter(line => line.trim().length > 0)
						}]
					});
				} catch (error) {
					reject(error);
				}
			});
			
			// 开始解析
			epub.parse();
		});
	}
	
	/**
	 * 移除HTML标签，提取纯文本（加强图片过滤）
	 */
	_stripHtml(html) {
		// 移除script和style标签及其内容
		let text = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
		text = text.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');
		
		// === 加强图片内容过滤 ===
		
		// 1. 移除img标签（包括所有属性）
		text = text.replace(/<img[^>]*\/?>/gi, '');
		
		// 2. 移除svg标签及其内容（矢量图形）
		text = text.replace(/<svg\b[^<]*(?:(?!<\/svg>)<[^<]*)*<\/svg>/gi, '');
	    
		// 3. 移除figure标签及其内容（通常包含图片和图注）
		text = text.replace(/<figure\b[^<]*(?:(?!<\/figure>)<[^<]*)*<\/figure>/gi, '');
		
		// 4. 移除picture标签及其内容（响应式图片）
		text = text.replace(/<picture\b[^<]*(?:(?!<\/picture>)<[^<]*)*<\/picture>/gi, '');
		
		// 5. 移除canvas标签及其内容（画布元素）
		text = text.replace(/<canvas\b[^<]*(?:(?!<\/canvas>)<[^<]*)*<\/canvas>/gi, '');
		
		// 6. 移除video标签及其内容（视频）
		text = text.replace(/<video\b[^<]*(?:(?!<\/video>)<[^<]*)*<\/video>/gi, '');
		
		// 7. 移除audio标签及其内容（音频）
		text = text.replace(/<audio\b[^<]*(?:(?!<\/audio>)<[^<]*)*<\/audio>/gi, '');
		
		// 8. 移除embed标签（嵌入内容）
		text = text.replace(/<embed[^>]*\/?>/gi, '');
		
		// 9. 移除object标签及其内容（嵌入对象）
		text = text.replace(/<object\b[^<]*(?:(?!<\/object>)<[^<]*)*<\/object>/gi, '');
		
		// 10. 移除iframe标签及其内容（内嵌框架）
		text = text.replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '');
		
		// 11. 移除base64编码的图片数据
		text = text.replace(/data:image\/[a-zA-Z+]+;base64,[A-Za-z0-9+/=]+/gi, '');
		
		// 12. 移除可能残留的图片URL（http/https开头的图片链接）
		text = text.replace(/https?:\/\/[^\s<>"]+\.(jpg|jpeg|png|gif|bmp|webp|svg|ico)/gi, '');
		
		// === 正常的HTML处理 ===
		
		// 替换常见的HTML标签为换行或空格
		text = text.replace(/<br\s*\/?>/gi, '\n');
		text = text.replace(/<\/p>/gi, '\n\n');
		text = text.replace(/<\/div>/gi, '\n');
		text = text.replace(/<\/h[1-6]>/gi, '\n\n');
		text = text.replace(/<\/li>/gi, '\n');
		text = text.replace(/<\/tr>/gi, '\n');
		
		// 移除所有剩余的HTML标签
		text = text.replace(/<[^>]+>/g, '');
		
		// 解码HTML实体
		text = text.replace(/&nbsp;/g, ' ');
		text = text.replace(/&lt;/g, '<');
		text = text.replace(/&gt;/g, '>');
		text = text.replace(/&amp;/g, '&');
		text = text.replace(/&quot;/g, '"');
		text = text.replace(/&#39;/g, "'");
		text = text.replace(/&#8217;/g, "'"); // 右单引号
		text = text.replace(/&#8220;/g, '"'); // 左双引号
		text = text.replace(/&#8221;/g, '"'); // 右双引号
		text = text.replace(/&#(\d+);/g, (match, dec) => String.fromCharCode(dec)); // 其他数字实体
		
		// 清理多余的空白
		text = text.replace(/\n\s*\n\s*\n/g, '\n\n');
		text = text.replace(/[ \t]+/g, ' '); // 合并多个空格
		text = text.trim();
		
		return text;
	}

	/**
	 * 加载粘贴的文本内容
	 */
	async _loadPastedContent(content) {
		try {
			this._statusBarItem.text = "thief-reader: 正在解析粘贴内容...";
			
			// 解析章节
			const chapters = this._extractChaptersWithFallback(content);
			
			const fileName = `粘贴内容_${Date.now()}`;
			const fileInfo = {
				id: Date.now().toString(),
				name: fileName,
				path: '',
				type: '粘贴',
				chapters: chapters,
				fullText: content,
				pages: chapters.length,
				status: 'active',
				// 初始化阅读位置
				lastChapter: null,
				lastScrollOffset: 0,
				lastReadTime: null
			};

			// 添加到文件列表
			this._pdfFiles.push(fileInfo);
			
			// 自动选中这个文件
			this._currentPdf = fileInfo;
			this._currentChapter = chapters.length > 0 ? 0 : null;
			this._currentPage = 0;
			this._scrollOffset = 0;

			this._statusBarItem.text = `thief-reader: 已加载粘贴内容`;
			vscode.window.showInformationMessage(`成功加载粘贴内容，共${chapters.length}个章节`);
			
			// 保存状态
			this._saveCurrentState();
			
			// 刷新界面
			this._refreshView();
		} catch (error) {
			this._statusBarItem.text = "thief-reader: 加载失败";
			vscode.window.showErrorMessage(`加载粘贴内容失败: ${error.message}`);
		}
	}

	/**
	 * 提取章节信息（带备用方案）
	 */
	_extractChaptersWithFallback(text) {
		// 先尝试正常的章节提取
		const chapters = this._extractChapters(text);
		
		// 如果成功提取到章节（不是默认的"全文内容"），直接返回
		if (chapters.length > 1 || (chapters.length === 1 && chapters[0].title !== '全文内容')) {
			return chapters;
		}
		
		// 如果没有识别出章节，按段落分割，每段用前10个字作为标题
		return this._createFallbackChapters(text);
	}

	/**
	 * 创建备用章节（使用前10个字作为标题）
	 */
	_createFallbackChapters(text) {
		const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim().length > 0);
		const chapters = [];
		
		if (paragraphs.length === 0) {
			// 如果连段落都没有，按整行分割
			const lines = text.split('\n').filter(line => line.trim().length > 10);
			
			lines.forEach((line, index) => {
				const trimmedLine = line.trim();
				// 取前10个字符作为标题
				const title = trimmedLine.substring(0, 10) + (trimmedLine.length > 10 ? '...' : '');
				
				chapters.push({
					title: title,
					startLine: 0,
					content: [trimmedLine]
				});
			});
		} else {
			// 按段落分割
			paragraphs.forEach((paragraph, index) => {
				const lines = paragraph.split('\n').filter(line => line.trim().length > 0);
				if (lines.length > 0) {
					const firstLine = lines[0].trim();
					// 取前10个字符作为标题
					const title = firstLine.substring(0, 10) + (firstLine.length > 10 ? '...' : '');
					
					chapters.push({
						title: title,
						startLine: 0,
						content: lines
					});
				}
			});
		}
		
		// 如果还是没有章节，创建单个章节
		if (chapters.length === 0) {
			const firstLine = text.trim().substring(0, 10) + '...';
			chapters.push({
				title: firstLine,
				startLine: 0,
				content: text.split('\n').filter(line => line.trim().length > 0)
			});
		}
		
		return chapters;
	}

	/**
	 * 提取章节信息
	 */
	_extractChapters(text) {
		const chapters = [];
		const lines = text.split('\n');
		let currentChapter = null;
		let chapterIndex = 0;

		// 扩展的章节检测规则，适用于PDF和TXT
		const chapterPatterns = [
			// 中文章节模式
			/^第[一二三四五六七八九十\d]+章\s*[：:\-]?\s*(.+)/,
			/^第\d+章\s*[：:\-]?\s*(.+)/,
			/^[一二三四五六七八九十]+、\s*(.+)/,
			/^[\d]+\.\s*(.+)/,
			/^[\d]+[\s]*[、．.]\s*(.+)/,
			
			// 英文章节模式
			/^Chapter\s+\d+\s*[:\-]?\s*(.+)/i,
			/^CHAPTER\s+\d+\s*[:\-]?\s*(.+)/i,
			
			// 标题模式（适用于TXT文件）
			/^={3,}\s*(.+)\s*={3,}/,  // ===标题===
			/^-{3,}\s*(.+)\s*-{3,}/,  // ---标题---
			/^\*{3,}\s*(.+)\s*\*{3,}/, // ***标题***
			
			// 简单的标题模式
			/^【(.+)】$/,  // 【标题】
			/^《(.+)》$/,  // 《标题》
			
			// 数字编号
			/^(\d+)\s*[、．.]\s*(.+)/,
			/^(\d+)\s+(.+)/
		];

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i].trim();
			if (!line) continue;

			// 检查是否匹配章节模式
			let isChapter = false;
			let chapterTitle = '';

			for (const pattern of chapterPatterns) {
				const match = line.match(pattern);
				if (match) {
					isChapter = true;
					// 取最后一个捕获组作为标题，如果没有则取整行
					chapterTitle = match[match.length - 1] || match[0];
					// 清理标题中的多余空格和符号
					chapterTitle = chapterTitle.replace(/^\s*[：:\-]\s*/, '').trim();
					break;
				}
			}

			// 额外检查：如果行很短且看起来像标题
			if (!isChapter && line.length > 2 && line.length < 50) {
				// 检查是否全部是大写字母（可能是英文标题）
				if (/^[A-Z\s\d\-_]+$/.test(line)) {
					isChapter = true;
					chapterTitle = line;
				}
				// 检查是否包含常见的标题关键词
				else if (/^(序言|前言|引言|结语|附录|目录|索引|参考文献|致谢)/i.test(line)) {
					isChapter = true;
					chapterTitle = line;
				}
			}

			if (isChapter) {
				// 保存上一章节
				if (currentChapter) {
					chapters.push(currentChapter);
				}

				// 开始新章节
				currentChapter = {
					title: chapterTitle,
					startLine: i,
					content: []
				};
				chapterIndex++;
			} else if (currentChapter && line.length > 5) {
				// 添加内容到当前章节（降低最小长度要求）
				currentChapter.content.push(line);
			} else if (!currentChapter && line.length > 5) {
				// 如果还没有章节，创建一个默认章节
				if (chapters.length === 0) {
					currentChapter = {
						title: '开始内容',
						startLine: i,
						content: [line]
					};
				}
			}
		}

		// 添加最后一个章节
		if (currentChapter) {
			chapters.push(currentChapter);
		}

		// 如果没有检测到章节，按段落自动分割
		if (chapters.length === 0) {
			const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim().length > 0);
			if (paragraphs.length > 1) {
				paragraphs.forEach((paragraph, index) => {
					const paragraphLines = paragraph.split('\n').filter(line => line.trim().length > 0);
					if (paragraphLines.length > 0) {
						chapters.push({
							title: `段落 ${index + 1}`,
							startLine: 0,
							content: paragraphLines
						});
					}
				});
			} else {
				// 最后的备选方案：创建单个章节
				chapters.push({
					title: '全文内容',
					startLine: 0,
					content: lines.filter(line => line.trim().length > 0)
				});
			}
		}

		return chapters;
	}

	/**
	 * 从列表中选择文件
	 */
	async _selectPdfFromList(fileId) {
		const file = this._pdfFiles.find(f => f.id === fileId);
		if (!file) return;
		
		// 检查文件状态
		if (file.status === 'missing') {
			vscode.window.showWarningMessage(
				`文件 "${file.name}" 已不存在，无法打开`
			);
			return;
		}
		
		if (file.status === 'error') {
			vscode.window.showWarningMessage(
				`文件 "${file.name}" 解析失败，无法打开`
			);
			return;
		}
		
		// 步骤1：保存当前文件的阅读位置
		if (this._currentPdf && this._currentPdf.id !== fileId) {
			this._saveFileReadingPosition(this._currentPdf.id);
		}
		
		// 步骤2：切换到新文件
		this._currentPdf = file;
		
		// 步骤3：恢复新文件的阅读位置
		this._restoreFileReadingPosition(file);
		
		// 步骤4：显示内容
		if (this._currentChapter !== null && file.chapters && file.chapters.length > 0) {
			const chapter = file.chapters[this._currentChapter];
			this._displayChapterText(chapter);
			this._statusBarItem.text = `thief-reader: ${file.name} - ${chapter.title}`;
		} else {
			this._statusBarItem.text = `thief-reader: 已选择 ${file.name} [${file.type}]`;
		}
		
		// 步骤5：保存状态并刷新界面
		this._saveCurrentState();
		this._refreshView();
	}

	/**
	 * 选择章节
	 */
	async _selectChapter(chapterId) {
		if (!this._currentPdf || !this._currentPdf.chapters) return;

		const chapterIndex = parseInt(chapterId);
		if (chapterIndex >= 0 && chapterIndex < this._currentPdf.chapters.length) {
			this._currentChapter = chapterIndex;
			this._currentPage = 0;
			this._scrollOffset = 0; // 重置滑动偏移
			
			const chapter = this._currentPdf.chapters[chapterIndex];
			this._displayChapterText(chapter);
			this._saveCurrentState();
			this._refreshView();
		}
	}

	/**
	 * 显示章节文字 - 全局连续滑动，确保能看到所有字符
	 */
	_displayChapterText(chapter) {
		if (!chapter || !chapter.content) return;

		// 如果状态栏文字被隐藏，不更新内容
		if (!this._statusBarVisible) {
			return;
		}

		// 获取完整章节内容（不再分页）
		const fullContent = chapter.content.join(' ');
		const totalLength = fullContent.length;
		
		// 固定显示长度
		const displayLength = 80;
		
		// 计算最大偏移量：允许滑动到最后一个字符
		// 让最后一个字符可以显示在窗口的开始位置
		const maxScrollOffset = Math.max(0, totalLength - 1);
		
		// 确保偏移量在有效范围内
		this._scrollOffset = Math.max(0, Math.min(this._scrollOffset, maxScrollOffset));
		
		// 从全局偏移量提取显示内容
		// 如果接近末尾，可能显示不足displayLength个字符
		const actualEndPos = Math.min(this._scrollOffset + displayLength, totalLength);
		const displayContent = fullContent.substring(this._scrollOffset, actualEndPos);
		
		// 滚动指示器：显示当前位置和总长度
		const scrollIndicator = totalLength > displayLength 
			? ` [${this._scrollOffset}-${actualEndPos}/${totalLength}]` 
			: '';
		
		// 应用透明度到文本颜色
		// 基础颜色：rgba(135,135,135,1)，根据透明度设置调整alpha值
		const alpha = (this._opacity / 100).toFixed(2);
		this._statusBarItem.color = `rgba(135, 135, 135, ${alpha})`;

		this._statusBarItem.text = `thief-reader: ${chapter.title}${scrollIndicator} - ${displayContent}`;
	}

	/**
	 * 删除文件
	 */
	_removePdfFile(fileId) {
		const index = this._pdfFiles.findIndex(f => f.id === fileId);
		if (index !== -1) {
			const file = this._pdfFiles[index];
			const fileName = file.name;
			const fileType = file.type;
			this._pdfFiles.splice(index, 1);
			
			// 如果删除的是当前选中的文件，清空选择
			if (this._currentPdf && this._currentPdf.id === fileId) {
				this._currentPdf = null;
				this._currentChapter = null;
				this._currentPage = 0;
				this._scrollOffset = 0;
				this._statusBarItem.text = "thief-reader: 准备就绪";
			}
			
			vscode.window.showInformationMessage(`已删除${fileType}文件: ${fileName}`);
			this._saveCurrentState();
			this._refreshView();
		}
	}

	/**
	 * 注册键盘快捷键
	 */
	_registerKeyBindings() {
		// 注册翻页命令 (Alt + Shift + 左右方向键)
		const previousPageCommand = vscode.commands.registerCommand('thief-reader.previousPage', () => {
			this._previousPage();
		});

		const nextPageCommand = vscode.commands.registerCommand('thief-reader.nextPage', () => {
			this._nextPage();
		});

		// 注册滑动命令 (Alt + 左右方向键)
		const scrollLeftCommand = vscode.commands.registerCommand('thief-reader.scrollLeft', () => {
			this._scrollLeft();
		});

		const scrollRightCommand = vscode.commands.registerCommand('thief-reader.scrollRight', () => {
			this._scrollRight();
		});

		// 注册切换显示命令 (Shift + 空格键)
		const toggleVisibilityCommand = vscode.commands.registerCommand('thief-reader.toggleVisibility', () => {
			this._toggleStatusBarVisibility();
		});

		this._context.subscriptions.push(
			previousPageCommand, 
			nextPageCommand, 
			scrollLeftCommand, 
			scrollRightCommand,
			toggleVisibilityCommand
		);
	}

	/**
	 * 上一页 (Alt + Shift + 左方向键) - 快速向前跳转80个字符
	 */
	_previousPage() {
		if (this._currentChapter !== null && this._currentPdf) {
			const jumpSize = 80; // 跳转一个显示窗口的大小
			
			if (this._scrollOffset > 0) {
				this._scrollOffset = Math.max(0, this._scrollOffset - jumpSize);
				const chapter = this._currentPdf.chapters[this._currentChapter];
				this._displayChapterText(chapter);
				this._saveCurrentState(); // 保存位置
			}
		}
	}

	/**
	 * 下一页 (Alt + Shift + 右方向键) - 快速向后跳转80个字符
	 */
	_nextPage() {
		if (this._currentChapter !== null && this._currentPdf) {
			const chapter = this._currentPdf.chapters[this._currentChapter];
			const fullContent = chapter.content.join(' ');
			const jumpSize = 80; // 跳转一个显示窗口的大小
			const maxScrollOffset = Math.max(0, fullContent.length - 1);
			
			if (this._scrollOffset < maxScrollOffset) {
				this._scrollOffset = Math.min(maxScrollOffset, this._scrollOffset + jumpSize);
				this._displayChapterText(chapter);
				this._saveCurrentState(); // 保存位置
			}
		}
	}

	/**
	 * 向左滑动 (Alt + 左方向键) - 在整个章节中向左滑动
	 */
	_scrollLeft() {
		if (this._currentChapter !== null && this._currentPdf) {
			const scrollStep = 10; // 每次滑动10个字符
			
			if (this._scrollOffset > 0) {
				this._scrollOffset = Math.max(0, this._scrollOffset - scrollStep);
				const chapter = this._currentPdf.chapters[this._currentChapter];
				this._displayChapterText(chapter);
				this._saveCurrentState(); // 保存滚动位置
			}
		}
	}

	/**
	 * 向右滑动 (Alt + 右方向键) - 在整个章节中向右滑动
	 */
	_scrollRight() {
		if (this._currentChapter !== null && this._currentPdf) {
			const scrollStep = 10; // 每次滑动10个字符
			const chapter = this._currentPdf.chapters[this._currentChapter];
			const fullContent = chapter.content.join(' ');
			const maxScrollOffset = Math.max(0, fullContent.length - 1);
			
			if (this._scrollOffset < maxScrollOffset) {
				this._scrollOffset = Math.min(maxScrollOffset, this._scrollOffset + scrollStep);
				this._displayChapterText(chapter);
				this._saveCurrentState(); // 保存滚动位置
			}
		}
	}

	/**
	 * 切换状态栏文字的显示/隐藏 (Shift + 空格键)
	 */
	_toggleStatusBarVisibility() {
		this._statusBarVisible = !this._statusBarVisible;
		
		if (this._statusBarVisible) {
			// 显示状态栏文字
			if (this._currentChapter !== null && this._currentPdf) {
				const chapter = this._currentPdf.chapters[this._currentChapter];
				this._displayChapterText(chapter);
			} else {
				this._statusBarItem.text = "thief-reader: 准备就绪";
			}
		} else {
			// 隐藏状态栏文字（只显示图标或简短提示）
			this._statusBarItem.text = "thief-reader: 📖";
		}
	}

	/**
	 * 设置透明度
	 * @param {number} value - 透明度值 (5-100)
	 */
	_setOpacity(value) {
		// 确保值在有效范围内
		this._opacity = Math.max(5, Math.min(100, value));
		
		// 更新状态栏的背景颜色（通过设置color属性的透明度）
		this._applyOpacityToStatusBar();
		
		// 保存设置到VS Code配置
		vscode.workspace.getConfiguration('thief-reader').update('statusBarOpacity', this._opacity, true);
	}

	/**
	 * 应用透明度到状态栏
	 */
	_applyOpacityToStatusBar() {
		if (this._statusBarItem && this._currentChapter !== null && this._currentPdf) {
			const chapter = this._currentPdf.chapters[this._currentChapter];
			this._displayChapterText(chapter);
		}
	}

	/**
	 * 发送当前透明度值到WebView
	 */
	_sendOpacityToView() {
		if (this._view) {
			this._view.webview.postMessage({
				command: 'setOpacity',
				value: this._opacity
			});
		}
	}

	/**
	 * 从配置中加载透明度
	 */
	_loadOpacity() {
		const config = vscode.workspace.getConfiguration('thief-reader');
		const savedOpacity = config.get('statusBarOpacity');
		if (savedOpacity !== undefined) {
			this._opacity = savedOpacity;
		}
	}

	/**
	 * 刷新视图
	 */
	_refreshView() {
		if (this._view) {
			this._view.webview.html = this._getHtmlContent();
		}
	}
}

// 当您的扩展被激活时调用此方法
// 您的扩展在第一次执行命令时被激活

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
	// 使用控制台输出诊断信息 (console.log) 和错误 (console.error)
	// 这行代码只会在扩展激活时执行一次
	console.log('恭喜，您的扩展 "thief-reader" 现在已激活！');

	// 创建 WebView 提供者
	const provider = new ThiefReaderWebviewProvider(context);

	// 注册 WebView 提供者
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider('thief-reader-main', provider)
	);

	// 保留原有的 Hello World 命令
	const disposable = vscode.commands.registerCommand('thief-reader.helloWorld', function () {
		// 向用户显示消息框
		vscode.window.showInformationMessage('来自 thief-reader 的问候！');
	});

	context.subscriptions.push(disposable);
}

// 当您的扩展被停用时调用此方法
function deactivate() {}

module.exports = {
	activate,
	deactivate
}
