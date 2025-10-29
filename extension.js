// 'vscode' 模块包含 VS Code 扩展性 API
// 导入模块并在下面的代码中使用别名 vscode 引用它
const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const pdf = require('pdf-parse');
const EPub = require('epub2').EPub;

/**
 * Alt键状态管理器类 - 监听和管理Alt键状态
 */
class AltKeyManager {
	constructor() {
		this._isAltPressed = false;
		this._listeners = [];
		this._disposables = [];
		this._forceEnabled = false; // 强制启用悬停功能（绕过Alt键检测）
	}

	/**
	 * 启动Alt键监听
	 */
	startListening() {
		// 由于VSCode API限制，我们使用编辑器选择变化来模拟键盘事件监听
		// 这里我们会在后续通过其他方式来检测Alt键状态
		console.log('Alt键监听已启动');
	}

	/**
	 * 检查Alt键是否按下
	 */
	isAltPressed() {
		return this._isAltPressed;
	}

	/**
	 * 设置Alt键状态（通过其他方式触发）
	 */
	setAltPressed(pressed) {
		const wasPressed = this._isAltPressed;
		this._isAltPressed = pressed;
		
		// 通知监听器
		if (wasPressed !== pressed) {
			this._notifyListeners(pressed);
		}
	}

	/**
	 * 强制启用/禁用悬停功能（绕过Alt键检测限制）
	 */
	setForceEnabled(enabled) {
		this._forceEnabled = enabled;
		console.log(`悬停功能强制${enabled ? '启用' : '禁用'}`);
	}

	/**
	 * 获取强制启用状态
	 */
	isForceEnabled() {
		return this._forceEnabled;
	}

	/**
	 * 切换强制启用状态
	 */
	toggleForceEnabled() {
		this._forceEnabled = !this._forceEnabled;
		console.log(`悬停功能强制${this._forceEnabled ? '启用' : '禁用'}`);
		return this._forceEnabled;
	}

	/**
	 * 添加状态变化监听器
	 */
	addListener(listener) {
		this._listeners.push(listener);
	}

	/**
	 * 移除监听器
	 */
	removeListener(listener) {
		const index = this._listeners.indexOf(listener);
		if (index > -1) {
			this._listeners.splice(index, 1);
		}
	}

	/**
	 * 通知所有监听器
	 */
	_notifyListeners(isPressed) {
		this._listeners.forEach(listener => {
			try {
				listener(isPressed);
			} catch (error) {
				console.error('Alt键状态监听器执行错误:', error);
			}
		});
	}

	/**
	 * 清理资源
	 */
	dispose() {
		this._disposables.forEach(disposable => disposable.dispose());
		this._disposables = [];
		this._listeners = [];
	}
}

/**
 * 滚轮滚动处理器类 - 处理悬浮窗中的滚轮滚动
 */
class ScrollWheelHandler {
	constructor(readerProvider) {
		this._readerProvider = readerProvider;
		this._scrollStep = 50; // 每次滚动的字符数
		this._scrollPosition = 0; // 悬浮窗独立的滚动位置
		this._maxScrollPosition = 0;
		this._isInitialized = false;
	}

	/**
	 * 初始化滚动位置（与当前阅读位置同步）
	 */
	initialize() {
		if (this._readerProvider._currentFile && this._readerProvider._currentChapter !== null) {
			this._scrollPosition = this._readerProvider._scrollOffset;
			this._maxScrollPosition = this._getCurrentChapterLength();
			this._isInitialized = true;
		}
	}

	/**
	 * 处理滚轮事件
	 */
	handleWheelEvent(deltaY, ctrlKey = false) {
		if (!this._readerProvider._currentFile || this._readerProvider._currentChapter === null) {
			return null;
		}

		if (!this._isInitialized) {
			this.initialize();
		}

		// 计算滚动步长
		const step = ctrlKey ? this._scrollStep * 2 : this._scrollStep;
		const direction = Math.sign(deltaY);
		
		// 计算新的滚动位置
		const newPosition = Math.max(0, this._scrollPosition + (direction * step));
		const maxPosition = Math.max(0, this._maxScrollPosition - 200); // 保留一些缓冲
		
		this._scrollPosition = Math.min(newPosition, maxPosition);
		
		// 生成新内容
		return this._generateScrolledContent();
	}

	/**
	 * 获取当前章节长度
	 */
	_getCurrentChapterLength() {
		const currentFile = this._readerProvider._currentFile;
		if (!currentFile || !currentFile.chapters || this._readerProvider._currentChapter === null) {
			return 0;
		}
		
		const chapter = currentFile.chapters[this._readerProvider._currentChapter];
		if (!chapter) return 0;
		
		// 使用辅助函数处理内容
		const fullContent = getChapterContentAsString(chapter);
		return fullContent.length;
	}

	/**
	 * 生成滚动后的内容
	 */
	_generateScrolledContent() {
		const currentFile = this._readerProvider._currentFile;
		if (!currentFile || !currentFile.chapters || this._readerProvider._currentChapter === null) {
			return null;
		}

		const chapter = currentFile.chapters[this._readerProvider._currentChapter];
		if (!chapter) return null;

		// 获取显示的文字内容
		const displayLength = 300; // 悬浮窗显示的字符数
		
		// 使用辅助函数处理内容
		const fullContent = getChapterContentAsString(chapter);
		if (!fullContent) {
			console.error('Empty or invalid chapter content');
			return null;
		}
		
		const text = fullContent.substring(this._scrollPosition, this._scrollPosition + displayLength);
		
		// 生成位置信息
		const position = `${this._scrollPosition}-${this._scrollPosition + text.length}/${fullContent.length}`;
		
		return {
			text: text,
			chapterTitle: chapter.title,
			position: position,
			scrollPosition: this._scrollPosition,
			maxPosition: fullContent.length,
			hasMore: this._scrollPosition + displayLength < fullContent.length
		};
	}

	/**
	 * 同步滚动位置到状态栏（当悬浮窗隐藏时调用）
	 */
	syncToStatusBar() {
		if (this._readerProvider._currentFile && this._isInitialized) {
			// 更新主阅读器的滚动位置
			this._readerProvider._scrollOffset = this._scrollPosition;
			
			// 保存当前状态
			this._readerProvider._saveCurrentState();
			
			// 更新状态栏显示
			this._readerProvider._displayChapterText();
			
			console.log(`滚动位置已同步到状态栏: ${this._scrollPosition}`);
		}
	}

	/**
	 * 重置滚动位置
	 */
	reset() {
		this._scrollPosition = 0;
		this._maxScrollPosition = 0;
		this._isInitialized = false;
	}

	/**
	 * 获取当前滚动位置
	 */
	getCurrentPosition() {
		return this._scrollPosition;
	}

	/**
	 * 设置滚动步长
	 */
	setScrollStep(step) {
		this._scrollStep = Math.max(10, Math.min(200, step)); // 限制在合理范围内
	}
}

/**
 * 内容处理辅助函数 - 处理章节内容可能是数组或字符串的情况
 */
function getChapterContentAsString(chapter) {
	if (!chapter || !chapter.content) {
		return '';
	}

	if (Array.isArray(chapter.content)) {
		return chapter.content.join('\n'); // 数组情况：用换行符连接
	} else if (typeof chapter.content === 'string') {
		return chapter.content; // 字符串情况：直接使用
	} else {
		console.warn('Unexpected chapter.content type:', typeof chapter.content, chapter.content);
		return String(chapter.content); // 强制转换为字符串
	}
}

/**
 * 悬浮窗管理器类 - 管理Alt+悬停时的悬浮预览窗口
 */
class FloatingWindowManager {
	constructor(context, readerProvider, scrollHandler) {
		this._context = context;
		this._readerProvider = readerProvider;
		this._scrollHandler = scrollHandler;
		this._webviewPanel = null;
		this._isVisible = false;
		this._currentContent = null;
		this._debounceTimer = null;
		// 添加滚动位置记录
		this._lastScrollTop = 0;
		this._lastScrollPercentage = 0;
		this._lastCharOffset = 0; // 添加字符偏移量记录
		this._popupTextOpacity = 100; // 弹窗文字透明度，默认100%
		this._loadPopupOpacity(); // 从配置中加载透明度
	}

	/**
	 * 显示完整章节预览
	 */
	async showChapterPreview() {
		try {
			const currentFile = this._readerProvider._currentFile;
			if (!currentFile || this._readerProvider._currentChapter === null) {
				vscode.window.showWarningMessage('请先加载文件并选择章节');
				return;
			}

			const chapter = currentFile.chapters[this._readerProvider._currentChapter];
			if (!chapter) {
				vscode.window.showWarningMessage('当前章节无效');
				return;
			}

			// 获取完整章节内容
			const fullContent = getChapterContentAsString(chapter);
			const currentOffset = this._readerProvider._scrollOffset;

			// 初始化字符偏移量为当前状态栏的偏移量
			this._lastCharOffset = currentOffset;
			this._lastScrollPercentage = this._calculateScrollPercentage(currentOffset, fullContent);

			const previewData = {
				chapterTitle: chapter.title,
				fullContent: fullContent,
				currentOffset: currentOffset,
				totalLength: fullContent.length,
				initialScrollPercentage: this._lastScrollPercentage
			};

			// 如果悬浮窗已存在，直接更新内容
			if (this._webviewPanel) {
				this._updateChapterPreview(previewData);
				return;
			}

			// 创建新的章节预览窗
			this._webviewPanel = vscode.window.createWebviewPanel(
				'thiefReaderChapterPreview',
				`${chapter.title} - 章节预览`,
				{
					viewColumn: vscode.ViewColumn.Beside,
					preserveFocus: true
				},
				{
					enableScripts: true,
					retainContextWhenHidden: true,
					localResourceRoots: []
				}
			);

			// 设置WebView内容
			this._webviewPanel.webview.html = this._generateChapterPreviewHtml();
			
			// 设置消息处理
			this._setupChapterPreviewMessageHandling();
			
			// 设置面板关闭事件
			this._webviewPanel.onDidDispose(() => {
				this._onChapterPreviewDisposed();
			});

			// 更新内容并滚动到当前位置
			this._updateChapterPreview(previewData);
			this._isVisible = true;

			console.log('章节预览窗已显示:', chapter.title);

		} catch (error) {
			console.error('显示章节预览窗失败:', error);
			vscode.window.showErrorMessage('显示章节预览失败: ' + error.message);
		}
	}

	/**
	 * 在指定位置显示悬浮窗（保留旧方法用于兼容）
	 */
	async showAt(content) {
		// 重定向到新的章节预览方法
		return this.showChapterPreview();
	}

	/**
	 * 隐藏悬浮窗
	 */
	hide() {
		if (this._webviewPanel) {
			// 使用最后记录的滚动位置进行同步（避免向disposed WebView发送消息）
			this._syncLastScrollPositionToStatusBar();
			
			// 关闭面板
			this._webviewPanel.dispose();
			this._webviewPanel = null;
			this._isVisible = false;
			this._currentContent = null;

			console.log('章节预览窗已隐藏');
		}
	}

	/**
	 * 切换章节预览显示状态
	 */
	toggleChapterPreview() {
		if (this._isVisible) {
			this.hide();
		} else {
			this.showChapterPreview();
		}
	}

	/**
	 * 计算滚动百分比
	 */
	_calculateScrollPercentage(currentOffset, fullContent) {
		if (!fullContent || fullContent.length === 0) {
			return 0;
		}
		return Math.min(currentOffset / fullContent.length, 1);
	}

	/**
	 * 更新章节预览内容
	 */
	_updateChapterPreview(previewData) {
		if (!this._webviewPanel || !previewData) {
			return;
		}

		// 防抖更新
		if (this._debounceTimer) {
			clearTimeout(this._debounceTimer);
		}

		this._debounceTimer = setTimeout(() => {
			// 发送内容更新消息，包含保存的透明度
			this._webviewPanel.webview.postMessage({
				type: 'updateChapterPreview',
				data: previewData,
				popupTextOpacity: this._popupTextOpacity
			});
		}, 50); // 50ms防抖
	}

	/**
	 * 同步滚动位置到状态栏（安全版本，检查WebView状态）
	 */
	async _syncScrollPositionToStatusBar() {
		if (!this._webviewPanel || !this._isVisible) return;

		try {
			// 检查WebView是否还有效
			if (this._webviewPanel.webview) {
				// 请求WebView返回当前滚动位置
				this._webviewPanel.webview.postMessage({
					type: 'requestScrollPosition'
				});
			} else {
				// WebView无效，使用最后记录的位置
				this._syncLastScrollPositionToStatusBar();
			}
		} catch (error) {
			console.warn('同步滚动位置失败，使用备用方案:', error.message);
			// 发生错误时使用最后记录的滚动位置
			this._syncLastScrollPositionToStatusBar();
		}
	}

	/**
	 * 使用最后记录的滚动位置同步到状态栏
	 */
	_syncLastScrollPositionToStatusBar() {
		try {
			const currentFile = this._readerProvider._currentFile;
			if (!currentFile || this._readerProvider._currentChapter === null) return;

			const chapter = currentFile.chapters[this._readerProvider._currentChapter];
			if (!chapter) return;

			const fullContent = getChapterContentAsString(chapter);
			
			// 优先使用字符偏移量，如果没有则使用百分比计算
			let newTextOffset = this._lastCharOffset;
			
			// 如果字符偏移量为0但百分比不为0，说明可能是旧版本数据，使用百分比计算
			if (newTextOffset === 0 && this._lastScrollPercentage > 0) {
				newTextOffset = Math.floor(this._lastScrollPercentage * fullContent.length);
				console.log(`使用百分比计算偏移量: ${this._lastScrollPercentage.toFixed(4)} -> ${newTextOffset}`);
			} else {
				console.log(`使用字符偏移量: ${newTextOffset}`);
			}
			
			// 确保偏移量在有效范围内
			newTextOffset = Math.max(0, Math.min(newTextOffset, fullContent.length - 1));
			
			// 更新状态栏位置
			this._readerProvider._scrollOffset = newTextOffset;
			
			// 立即更新状态栏显示（传入章节参数）
			this._readerProvider._displayChapterText(chapter);
			
			// 保存当前状态（包括章节位置）
			this._readerProvider._saveChapterPosition(this._readerProvider._currentChapter, newTextOffset);
			this._readerProvider._saveCurrentState();
			
			// 强制刷新状态栏显示（确保图标同步）
			setTimeout(() => {
				this._readerProvider._displayChapterText(chapter);
			}, 50);
			
			console.log(`✅ 弹窗滚动位置已同步到状态栏: 字符偏移量 ${newTextOffset}`);
		} catch (error) {
			console.error('同步滚动位置失败:', error);
		}
	}

	/**
	 * 检查悬浮窗是否可见
	 */
	isVisible() {
		return this._isVisible && this._webviewPanel !== null;
	}

	/**
	 * 从配置中加载弹窗文字透明度
	 */
	_loadPopupOpacity() {
		const config = vscode.workspace.getConfiguration('thief-reader');
		const savedOpacity = config.get('popupTextOpacity');
		if (savedOpacity !== undefined) {
			this._popupTextOpacity = savedOpacity;
		}
	}

	/**
	 * 保存弹窗文字透明度到配置
	 */
	_savePopupOpacity(value) {
		this._popupTextOpacity = Math.max(10, Math.min(100, value));
		vscode.workspace.getConfiguration('thief-reader').update('popupTextOpacity', this._popupTextOpacity, true);
	}

	/**
	 * 更新悬浮窗内容
	 */
	_updateContent(content) {
		if (!this._webviewPanel || !content) {
			return;
		}

		// 防抖更新
		if (this._debounceTimer) {
			clearTimeout(this._debounceTimer);
		}

		this._debounceTimer = setTimeout(() => {
			this._currentContent = content;
			
			// 发送内容更新消息
			this._webviewPanel.webview.postMessage({
				type: 'updateContent',
				data: content
			});
		}, 50); // 50ms防抖
	}

	/**
	 * 设置章节预览消息处理
	 */
	_setupChapterPreviewMessageHandling() {
		this._webviewPanel.webview.onDidReceiveMessage(message => {
			switch (message.type) {
				case 'scrollPositionChanged':
					this._handleScrollPositionChanged(message.scrollTop, message.scrollPercentage, message.charOffset);
					break;
				
				case 'popupOpacityChanged':
					this._savePopupOpacity(message.value);
					break;
				
				case 'hide':
					this.hide();
					break;
				
				case 'ready':
					// WebView准备就绪
					console.log('章节预览WebView已准备就绪');
					break;

				case 'scrollPositionResponse':
					// 处理滚动位置响应
					this._handleScrollPositionResponse(message.scrollTop, message.scrollPercentage, message.charOffset);
					break;
			}
		});
	}

	/**
	 * 设置消息处理（保留旧方法用于兼容）
	 */
	_setupMessageHandling() {
		return this._setupChapterPreviewMessageHandling();
	}

	/**
	 * 处理滚动位置变化
	 */
	_handleScrollPositionChanged(scrollTop, scrollPercentage, charOffset) {
		// 实时更新但不立即同步到状态栏（避免频繁更新）
		this._lastScrollTop = scrollTop;
		this._lastScrollPercentage = scrollPercentage;
		this._lastCharOffset = charOffset || 0;
	}

	/**
	 * 处理滚动位置响应（用于同步到状态栏）
	 */
	_handleScrollPositionResponse(scrollTop, scrollPercentage, charOffset) {
		try {
			const currentFile = this._readerProvider._currentFile;
			if (!currentFile || this._readerProvider._currentChapter === null) return;

			const chapter = currentFile.chapters[this._readerProvider._currentChapter];
			if (!chapter) return;

			const fullContent = getChapterContentAsString(chapter);
			
			// 优先使用字符偏移量，如果没有则使用百分比计算
			let newTextOffset = charOffset || Math.floor(scrollPercentage * fullContent.length);
			
			// 确保偏移量在有效范围内
			newTextOffset = Math.max(0, Math.min(newTextOffset, fullContent.length - 1));
			
			// 更新状态栏位置
			this._readerProvider._scrollOffset = newTextOffset;
			
			// 立即更新状态栏显示（传入章节参数）
			this._readerProvider._displayChapterText(chapter);
			
			// 保存当前状态
			this._readerProvider._saveCurrentState();
			
			console.log(`滚动位置已同步: 字符偏移量 ${newTextOffset}`);
		} catch (error) {
			console.error('处理滚动位置响应失败:', error);
		}
	}

	/**
	 * 处理滚轮滚动事件
	 */
	_handleWheelScroll(deltaY, ctrlKey = false) {
		const newContent = this._scrollHandler.handleWheelEvent(deltaY, ctrlKey);
		if (newContent) {
			this._updateContent(newContent);
		}
	}

	/**
	 * 章节预览面板关闭事件处理
	 */
	_onChapterPreviewDisposed() {
		// 使用最后记录的滚动位置进行同步（WebView已经disposed，无法发送消息）
		this._syncLastScrollPositionToStatusBar();
		
		this._webviewPanel = null;
		this._isVisible = false;
		this._currentContent = null;
		
		// 清理滚动位置记录
		this._lastScrollTop = 0;
		this._lastScrollPercentage = 0;
		this._lastCharOffset = 0;
		
		console.log('章节预览面板已关闭');
	}

	/**
	 * 面板关闭事件处理（保留旧方法用于兼容）
	 */
	_onPanelDisposed() {
		return this._onChapterPreviewDisposed();
	}

	/**
	 * 生成章节预览的HTML内容
	 */
	_generateChapterPreviewHtml() {
		return `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>章节预览</title>
    <style>
        body {
            font-family: var(--vscode-font-family, 'Microsoft YaHei', sans-serif);
            font-size: 16px;
            line-height: 1.8;
            color: var(--vscode-foreground);
            background: var(--vscode-editor-background);
            margin: 0;
            padding: 0;
            overflow: hidden;
        }
        
        .container {
            display: flex;
            flex-direction: column;
            height: 100vh;
        }
        
		.header {
			flex-shrink: 0;
			padding: 16px 20px 8px 20px;
			background: var(--vscode-titleBar-activeBackground);
			border-bottom: 1px solid var(--vscode-panel-border);
			min-height: 60px;
		}
		
		.header-top {
			display: flex;
			justify-content: space-between;
			align-items: flex-start;
			margin-bottom: 8px;
		}
		
		.opacity-control {
			display: flex;
			align-items: center;
			gap: 10px;
			font-size: 12px;
			color: var(--vscode-titleBar-activeForeground);
			opacity: 0.8;
		}
		
		.opacity-control label {
			margin: 0;
		}
		
		.popup-opacity-slider {
			width: 120px;
			height: 4px;
			border-radius: 2px;
			background: var(--vscode-scrollbarSlider-background);
			outline: none;
			cursor: pointer;
			border: none;
		}
		
		.popup-opacity-slider:focus {
			outline: none !important;
			border: none !important;
			box-shadow: none !important;
		}
		
		.popup-opacity-slider::-webkit-slider-thumb {
			-webkit-appearance: none;
			width: 10px;
			height: 10px;
			border-radius: 50%;
			background: var(--vscode-titleBar-activeForeground);
			cursor: pointer;
			outline: none;
			border: none;
		}
		
		.popup-opacity-slider::-webkit-slider-thumb:focus {
			outline: none !important;
			border: none !important;
			box-shadow: none !important;
		}
		
		.popup-opacity-slider::-moz-range-thumb {
			width: 10px;
			height: 10px;
			border-radius: 50%;
			background: var(--vscode-titleBar-activeForeground);
			cursor: pointer;
			border: none;
			outline: none;
		}
		
		.popup-opacity-slider::-moz-range-thumb:focus {
			outline: none !important;
			border: none !important;
			box-shadow: none !important;
		}
        
		.chapter-title {
			font-weight: bold;
			font-size: 16px;
			color: var(--vscode-titleBar-activeForeground);
			word-wrap: break-word;
			word-break: break-all;
			line-height: 1.4;
			max-width: calc(100% - 40px);
		}
        
		.close-button {
			background: none;
			border: none;
			color: var(--vscode-titleBar-activeForeground);
			font-size: 16px;
			cursor: pointer;
			padding: 4px 8px;
			border-radius: 4px;
			flex-shrink: 0;
			margin-left: 10px;
			align-self: flex-start;
		}
        
        .close-button:hover {
            background: var(--vscode-titleBar-inactiveBackground);
        }
        
        .content-wrapper {
            flex: 1;
            overflow-y: auto;
            padding: 0;
            position: relative;
        }
        
        .position-marker {
            position: absolute;
            left: 0;
            right: 0;
            height: 3px;
            background: var(--vscode-progressBar-background);
            z-index: 10;
            opacity: 0;
            transition: opacity 0.3s ease;
        }
        
        .position-marker.visible {
            opacity: 1;
        }
        
        .content {
            padding: 24px 32px;
            white-space: pre-wrap;
            word-wrap: break-word;
            line-height: 2.0;
            letter-spacing: 0.5px;
        }
        
        .content::-webkit-scrollbar {
            display: none;
        }
        
        .footer {
            flex-shrink: 0;
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
            padding: 8px 20px;
            text-align: center;
            background: var(--vscode-statusBar-background);
            border-top: 1px solid var(--vscode-panel-border);
        }
        
        .loading {
            text-align: center;
            color: var(--vscode-descriptionForeground);
            font-style: italic;
            padding: 40px 20px;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <div class="header-top">
                <div class="chapter-title" id="chapterTitle">
                    正在加载章节...
                </div>
                <button class="close-button" onclick="closePreview()" title="关闭预览">
                    ✕
                </button>
            </div>
            <div class="opacity-control">
                <label for="popup-opacity-slider">文字透明度: <span id="popup-opacity-value">100</span>%</label>
                <input type="range" id="popup-opacity-slider" class="popup-opacity-slider" min="10" max="100" value="100" step="5">
            </div>
        </div>
        
        <div class="content-wrapper" id="contentWrapper">
            <div class="position-marker" id="positionMarker"></div>
            <div class="content" id="content">
                <div class="loading">正在加载章节内容...</div>
            </div>
        </div>
        
        <div class="footer">
            📖 滚动阅读整章内容 • Shift+Space 切换显示 • ESC 关闭
        </div>
    </div>
    
    <script>
        let currentScrollPercentage = 0;
        let isScrolling = false;
        let scrollTimeout = null;
        let popupTextOpacity = 100; // 弹窗文字透明度
        
        // 获取VSCode API
        const vscode = acquireVsCodeApi();
        
        // 关闭预览
        function closePreview() {
            vscode.postMessage({ type: 'hide' });
        }
        
        // 应用文字透明度
        function applyTextOpacity(opacity) {
            const contentElement = document.getElementById('content');
            if (contentElement) {
                contentElement.style.opacity = (opacity / 100).toFixed(2);
            }
        }
        
        // 监听透明度滑块
        const opacitySlider = document.getElementById('popup-opacity-slider');
        if (opacitySlider) {
            opacitySlider.addEventListener('input', function(e) {
                const value = parseInt(e.target.value);
                popupTextOpacity = value;
                document.getElementById('popup-opacity-value').textContent = value;
                applyTextOpacity(value);
                
                // 发送消息保存透明度
                vscode.postMessage({
                    type: 'popupOpacityChanged',
                    value: value
                });
            });
        }
        
		// 监听滚动事件
		const contentWrapper = document.getElementById('contentWrapper');
		let fullContentText = '';
		
		// 计算可视区域第一个字符的偏移量
		function getCharOffsetAtTop() {
			const contentElement = document.getElementById('content');
			if (!contentElement || !fullContentText) return 0;
			
			try {
				// 获取content元素的位置
				const contentRect = contentElement.getBoundingClientRect();
				const wrapperRect = contentWrapper.getBoundingClientRect();
				
				// 计算可视区域顶部相对于content的位置
				const topY = wrapperRect.top - contentRect.top;
				
				// 如果在顶部之前，返回0
				if (topY <= 0) return 0;
				
				// 尝试使用document.caretRangeFromPoint获取字符位置
				const range = document.caretRangeFromPoint(contentRect.left + 10, wrapperRect.top + 5);
				if (range && range.startContainer) {
					// 遍历文本节点计算偏移量
					let charOffset = 0;
					const walker = document.createTreeWalker(
						contentElement,
						NodeFilter.SHOW_TEXT,
						null,
						false
					);
					
					let currentNode;
					while (currentNode = walker.nextNode()) {
						if (currentNode === range.startContainer) {
							charOffset += range.startOffset;
							return charOffset;
						}
						charOffset += currentNode.textContent.length;
					}
				}
				
				// 如果上述方法失败，使用百分比估算
				const scrollPercentage = contentWrapper.scrollTop / (contentWrapper.scrollHeight - contentWrapper.clientHeight);
				return Math.floor(scrollPercentage * fullContentText.length);
			} catch (e) {
				// 出错时使用百分比估算
				const scrollPercentage = contentWrapper.scrollTop / (contentWrapper.scrollHeight - contentWrapper.clientHeight);
				return Math.floor(scrollPercentage * fullContentText.length);
			}
		}
		
		contentWrapper.addEventListener('scroll', function(event) {
			const scrollTop = contentWrapper.scrollTop;
			const scrollHeight = contentWrapper.scrollHeight - contentWrapper.clientHeight;
			const scrollPercentage = scrollHeight > 0 ? scrollTop / scrollHeight : 0;
			
			currentScrollPercentage = scrollPercentage;
			isScrolling = true;
			
			// 使用精确方法计算字符偏移量
			const charOffset = getCharOffsetAtTop();
			
			// 调试日志
			if (scrollTop % 100 < 50) {
				console.log('Scroll:', scrollTop.toFixed(0) + 'px,', (scrollPercentage * 100).toFixed(1) + '%, charOffset:', charOffset);
			}
			
			// 显示位置标记
			const marker = document.getElementById('positionMarker');
			marker.style.top = scrollTop + 'px';
			marker.classList.add('visible');
			
			// 发送滚动位置变化，包含精确的字符偏移量
			vscode.postMessage({
				type: 'scrollPositionChanged',
				scrollTop: scrollTop,
				scrollPercentage: scrollPercentage,
				charOffset: charOffset
			});
			
			// 滚动停止后隐藏标记
			if (scrollTimeout) {
				clearTimeout(scrollTimeout);
			}
			scrollTimeout = setTimeout(() => {
				isScrolling = false;
				marker.classList.remove('visible');
			}, 500);
		});
        
        // 监听键盘事件
        document.addEventListener('keydown', function(event) {
            if (event.key === 'Escape') {
                closePreview();
            }
        });
        
        // 监听来自扩展的消息
        window.addEventListener('message', function(event) {
            const message = event.data;
            
            switch (message.type) {
                case 'updateChapterPreview':
                    updateChapterPreview(message.data);
                    // 应用保存的透明度
                    if (message.popupTextOpacity !== undefined) {
                        popupTextOpacity = message.popupTextOpacity;
                        const slider = document.getElementById('popup-opacity-slider');
                        const valueSpan = document.getElementById('popup-opacity-value');
                        if (slider && valueSpan) {
                            slider.value = message.popupTextOpacity;
                            valueSpan.textContent = message.popupTextOpacity;
                        }
                        applyTextOpacity(message.popupTextOpacity);
                    }
                    break;
                    
                case 'requestScrollPosition':
                    // 响应滚动位置请求，使用精确计算方法
                    vscode.postMessage({
                        type: 'scrollPositionResponse',
                        scrollTop: contentWrapper.scrollTop,
                        scrollPercentage: currentScrollPercentage,
                        charOffset: getCharOffsetAtTop()
                    });
                    break;
            }
        });
        
		// 更新章节预览内容
		function updateChapterPreview(data) {
			if (!data) return;
			
			// 更新标题
			document.getElementById('chapterTitle').textContent = data.chapterTitle;
            
            // 保存完整内容文本供滚动计算使用
            fullContentText = data.fullContent || '';
            
            // 更新内容并插入阅读位置标记
            const contentElement = document.getElementById('content');
            
            if (data.currentOffset !== undefined && data.fullContent) {
                // 在当前阅读位置插入标记
                const beforeText = data.fullContent.substring(0, data.currentOffset);
                const afterText = data.fullContent.substring(data.currentOffset);
                
                // 创建带标记的HTML内容
                contentElement.innerHTML = '';
                
                // 添加标记前的文本
                if (beforeText) {
                    const beforeSpan = document.createElement('span');
                    beforeSpan.textContent = beforeText;
                    contentElement.appendChild(beforeSpan);
                }
                
                // 添加当前阅读位置标记
                const markerSpan = document.createElement('span');
                markerSpan.id = 'currentReadingPosition';
                markerSpan.style.backgroundColor = 'var(--vscode-editor-findMatchHighlightBackground)';
                markerSpan.style.color = 'var(--vscode-editor-foreground)';
                markerSpan.style.padding = '2px 4px';
                markerSpan.style.borderRadius = '3px';
                markerSpan.style.boxShadow = '0 0 0 1px var(--vscode-editor-findMatchBorder)';
                
                // 获取状态栏显示长度的文字作为高亮内容
                const displayLength = 80;
                const highlightText = afterText.substring(0, Math.min(displayLength, afterText.length));
                markerSpan.textContent = highlightText;
                contentElement.appendChild(markerSpan);
                
                // 添加标记后的文本
                const remainingText = afterText.substring(highlightText.length);
                if (remainingText) {
                    const afterSpan = document.createElement('span');
                    afterSpan.textContent = remainingText;
                    contentElement.appendChild(afterSpan);
                }
                
                // 滚动到当前阅读位置
                setTimeout(() => {
                    const marker = document.getElementById('currentReadingPosition');
                    if (marker) {
                        marker.scrollIntoView({ 
                            behavior: 'smooth', 
                            block: 'start',
                            inline: 'nearest' 
                        });
                        
                        // 滚动完成后，手动设置当前的字符偏移量
                        setTimeout(() => {
                            const scrollTop = contentWrapper.scrollTop;
                            const scrollHeight = contentWrapper.scrollHeight - contentWrapper.clientHeight;
                            const scrollPercentage = scrollHeight > 0 ? scrollTop / scrollHeight : 0;
                            
                            currentScrollPercentage = scrollPercentage;
                            
                            // 使用精确计算方法获取字符偏移量
                            // 因为滚动后DOM已稳定，可以准确计算
                            const calculatedOffset = getCharOffsetAtTop();
                            
                            // 优先使用计算值，如果为0则使用初始值
                            const finalOffset = calculatedOffset > 0 ? calculatedOffset : data.currentOffset;
                            
                            vscode.postMessage({
                                type: 'scrollPositionChanged',
                                scrollTop: scrollTop,
                                scrollPercentage: scrollPercentage,
                                charOffset: finalOffset
                            });
                            
                            console.log('Initial position synced:', finalOffset);
                        }, 600);
                        
                        // 显示位置标记线
                        const positionMarker = document.getElementById('positionMarker');
                        const markerRect = marker.getBoundingClientRect();
                        const wrapperRect = contentWrapper.getBoundingClientRect();
                        positionMarker.style.top = (markerRect.top - wrapperRect.top + contentWrapper.scrollTop) + 'px';
                        positionMarker.classList.add('visible');
                        
                        setTimeout(() => {
                            positionMarker.classList.remove('visible');
                        }, 2000);
                    }
                }, 100);
            } else {
                // 如果没有偏移量，直接显示内容
                contentElement.textContent = data.fullContent;
            }
        }
        
        // 通知扩展WebView已准备就绪
        vscode.postMessage({ type: 'ready' });
    </script>
</body>
</html>`;
	}

	/**
	 * 生成WebView的HTML内容（保留旧方法用于兼容）
	 */
	_generateHtml() {
		return `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>阅读预览</title>
    <style>
        body {
            font-family: var(--vscode-font-family, 'Microsoft YaHei', sans-serif);
            font-size: 14px;
            line-height: 1.6;
            color: var(--vscode-foreground);
            background: var(--vscode-editor-background);
            margin: 0;
            padding: 16px;
            overflow: hidden;
            min-height: 100vh;
        }
        
        .container {
            max-width: 100%;
            height: calc(100vh - 32px);
            display: flex;
            flex-direction: column;
        }
        
        .header {
            font-weight: bold;
            margin-bottom: 12px;
            color: var(--vscode-textLink-foreground);
            border-bottom: 1px solid var(--vscode-panel-border);
            padding-bottom: 8px;
            flex-shrink: 0;
        }
        
        .content {
            flex: 1;
            overflow-y: auto;
            padding-right: 8px;
            white-space: pre-wrap;
            word-wrap: break-word;
        }
        
        .content::-webkit-scrollbar {
            width: 8px;
        }
        
        .content::-webkit-scrollbar-track {
            background: var(--vscode-scrollbarSlider-background);
            border-radius: 4px;
        }
        
        .content::-webkit-scrollbar-thumb {
            background: var(--vscode-scrollbarSlider-hoverBackground);
            border-radius: 4px;
        }
        
        .content::-webkit-scrollbar-thumb:hover {
            background: var(--vscode-scrollbarSlider-activeBackground);
        }
        
        .footer {
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
            margin-top: 12px;
            text-align: center;
            flex-shrink: 0;
            border-top: 1px solid var(--vscode-panel-border);
            padding-top: 8px;
        }
        
        .loading {
            text-align: center;
            color: var(--vscode-descriptionForeground);
            font-style: italic;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header" id="header">
            <div class="loading">正在加载...</div>
        </div>
        <div class="content" id="content">
            <div class="loading">请等待内容加载...</div>
        </div>
        <div class="footer">
            🖱️ 滚轮滚动文字 • Ctrl+滚轮快速滚动 • ESC隐藏
        </div>
    </div>
    
    <script>
        // 监听滚轮事件
        document.addEventListener('wheel', (event) => {
            event.preventDefault();
            
            // 发送滚轮事件到扩展
            vscode.postMessage({
                type: 'wheelScroll',
                deltaY: event.deltaY,
                ctrlKey: event.ctrlKey
            });
        });
        
        // 监听键盘事件
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') {
                vscode.postMessage({
                    type: 'hide'
                });
            }
        });
        
        // 监听来自扩展的消息
        window.addEventListener('message', event => {
            const message = event.data;
            
            switch (message.type) {
                case 'updateContent':
                    updateContent(message.data);
                    break;
            }
        });
        
        // 更新内容显示
        function updateContent(data) {
            if (!data) return;
            
            const headerElement = document.getElementById('header');
            const contentElement = document.getElementById('content');
            
            // 更新标题
            headerElement.textContent = \`\${data.chapterTitle} [\${data.position}]\`;
            
            // 更新内容
            contentElement.textContent = data.text;
            
            // 滚动到顶部
            contentElement.scrollTop = 0;
        }
        
        // 获取VSCode API
        const vscode = acquireVsCodeApi();
        
        // 通知扩展WebView已准备就绪
        vscode.postMessage({ type: 'ready' });
    </script>
</body>
</html>`;
	}
}

/**
 * 鼠标事件监听器和悬停提供器 - 检测Alt+悬停并显示预览
 */
class MouseEventListener {
	constructor(altKeyManager, floatingWindowManager, readerProvider, scrollHandler) {
		this._altKeyManager = altKeyManager;
		this._floatingWindowManager = floatingWindowManager;
		this._readerProvider = readerProvider;
		this._scrollHandler = scrollHandler;
		this._disposables = [];
		this._isHoverActive = false;
		this._showTimer = null;
		this._hideTimer = null;
		this._checkInterval = null;
	}

	/**
	 * 启动监听
	 */
	startListening() {
		// 监听编辑器光标位置变化（检测鼠标是否在编辑器中）
		const selectionChangeDisposable = vscode.window.onDidChangeTextEditorSelection((event) => {
			this._onEditorSelectionChange(event);
		});
		this._disposables.push(selectionChangeDisposable);

		// 监听活动编辑器变化
		const editorChangeDisposable = vscode.window.onDidChangeActiveTextEditor((editor) => {
			this._onEditorChange(editor);
		});
		this._disposables.push(editorChangeDisposable);

		// 监听Alt键状态变化
		this._altKeyManager.addListener(this._onAltKeyChanged.bind(this));

		// 定期检查编辑器状态（作为补充）
		this._startPeriodicCheck();

		console.log('编辑器事件监听器已启动');
	}

	/**
	 * 编辑器选择变化处理（检测鼠标活动）
	 */
	_onEditorSelectionChange(event) {
		// 检查是否启用悬停功能
		if (this._shouldShowFloatingWindow()) {
			this._showFloatingWindowDelayed();
		} else {
			this._hideFloatingWindowDelayed();
		}
	}

	/**
	 * 编辑器变化处理
	 */
	_onEditorChange(editor) {
		if (!editor) {
			// 没有活动编辑器，隐藏悬浮窗
			this._hideFloatingWindowDelayed();
		} else {
			// 有活动编辑器，检查是否应该显示
			if (this._shouldShowFloatingWindow()) {
				this._showFloatingWindowDelayed();
			}
		}
	}

	/**
	 * 定期检查编辑器状态
	 */
	_startPeriodicCheck() {
		// 每500ms检查一次状态
		this._checkInterval = setInterval(() => {
			if (this._shouldShowFloatingWindow()) {
				if (!this._isHoverActive) {
					this._showFloatingWindowDelayed();
				}
			} else {
				if (this._isHoverActive) {
					this._hideFloatingWindowDelayed();
				}
			}
		}, 500);
	}

	/**
	 * 检查是否应该显示悬浮窗
	 */
	_shouldShowFloatingWindow() {
		// 检查Alt键状态（真实的或强制启用的）
		if (!this._altKeyManager.isAltPressed() && !this._altKeyManager._forceEnabled) {
			return false;
		}

		// 检查是否有活动编辑器
		const editor = vscode.window.activeTextEditor;
		if (!editor) {
			return false;
		}

		// 检查是否有当前阅读内容
		if (!this._readerProvider._currentFile || this._readerProvider._currentChapter === null) {
			return false;
		}

		return true;
	}

	/**
	 * Alt键状态变化处理
	 */
	_onAltKeyChanged(isPressed) {
		console.log(`Alt键状态变化: ${isPressed ? '按下' : '释放'}`);
		
		if (isPressed) {
			// Alt键按下，检查是否应该显示悬浮窗
			if (this._shouldShowFloatingWindow()) {
				this._showFloatingWindowDelayed();
			}
		} else {
			// Alt键释放，隐藏悬浮窗
			this._hideFloatingWindowDelayed();
		}
	}

	/**
	 * 延迟显示悬浮窗
	 */
	_showFloatingWindowDelayed() {
		// 清除隐藏定时器
		if (this._hideTimer) {
			clearTimeout(this._hideTimer);
			this._hideTimer = null;
		}

		// 如果已经在显示，不需要重新显示
		if (this._isHoverActive || this._floatingWindowManager.isVisible()) {
			return;
		}

		// 延迟显示（避免频繁触发）
		if (this._showTimer) {
			clearTimeout(this._showTimer);
		}

		this._showTimer = setTimeout(() => {
			this._showFloatingWindow();
		}, 200); // 200ms延迟
	}

	/**
	 * 延迟隐藏悬浮窗
	 */
	_hideFloatingWindowDelayed() {
		// 清除显示定时器
		if (this._showTimer) {
			clearTimeout(this._showTimer);
			this._showTimer = null;
		}

		// 延迟隐藏（给用户时间移动到悬浮窗）
		if (this._hideTimer) {
			clearTimeout(this._hideTimer);
		}

		this._hideTimer = setTimeout(() => {
			this._hideFloatingWindow();
		}, 300); // 300ms延迟
	}

	/**
	 * 显示悬浮窗
	 */
	async _showFloatingWindow() {
		try {
			if (this._isHoverActive) return;

			// 获取当前阅读内容
			const content = this._getCurrentReaderContent();
			if (!content) return;

			// 初始化滚动处理器
			this._scrollHandler.initialize();

			// 显示悬浮窗
			await this._floatingWindowManager.showAt(content);
			this._isHoverActive = true;

			console.log('悬浮窗已显示:', content.chapterTitle);

		} catch (error) {
			console.error('显示悬浮窗失败:', error);
		}
	}

	/**
	 * 隐藏悬浮窗
	 */
	_hideFloatingWindow() {
		if (this._isHoverActive) {
			this._floatingWindowManager.hide();
			this._scrollHandler.reset();
			this._isHoverActive = false;
		}
	}

	/**
	 * 获取当前阅读内容
	 */
	_getCurrentReaderContent() {
		const currentFile = this._readerProvider._currentFile;
		if (!currentFile || !currentFile.chapters || this._readerProvider._currentChapter === null) {
			return null;
		}

		const chapter = currentFile.chapters[this._readerProvider._currentChapter];
		if (!chapter) return null;

		const scrollOffset = this._readerProvider._scrollOffset;
		const displayLength = 300; // 显示300个字符

		// 使用辅助函数处理内容
		const fullContent = getChapterContentAsString(chapter);
		if (!fullContent) {
			console.error('Empty or invalid chapter content in getCurrentReaderContent');
			return null;
		}

		// 获取文字内容
		const text = fullContent.substring(scrollOffset, scrollOffset + displayLength);
		const position = `${scrollOffset}-${scrollOffset + text.length}/${fullContent.length}`;

		return {
			text: text,
			chapterTitle: chapter.title,
			position: position,
			scrollPosition: scrollOffset,
			maxPosition: fullContent.length,
			hasMore: scrollOffset + displayLength < fullContent.length
		};
	}

	/**
	 * 手动触发Alt键状态（用于测试或命令触发）
	 */
	triggerAltKey(pressed) {
		this._altKeyManager.setAltPressed(pressed);
	}

	/**
	 * 清理资源
	 */
	dispose() {
		// 清理定时器
		if (this._showTimer) {
			clearTimeout(this._showTimer);
			this._showTimer = null;
		}
		if (this._hideTimer) {
			clearTimeout(this._hideTimer);
			this._hideTimer = null;
		}
		if (this._checkInterval) {
			clearInterval(this._checkInterval);
			this._checkInterval = null;
		}

		// 隐藏悬浮窗
		this._hideFloatingWindow();

		// 移除Alt键监听器
		this._altKeyManager.removeListener(this._onAltKeyChanged.bind(this));

		// 清理所有disposables
		this._disposables.forEach(disposable => disposable.dispose());
		this._disposables = [];
	}
}

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
				lastReadTime: file.lastReadTime ?? null,
				// 保存章节位置映射
				chapterPositions: file.chapterPositions || {}
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
		this._files = []; // 存储加载的所有文件信息（PDF/TXT/EPUB/粘贴内容）
		this._currentFile = null; // 当前选中的文件
		this._currentChapter = null; // 当前选中的章节
		this._currentPage = 0; // 当前页码
		this._scrollOffset = 0; // 文字滑动偏移量
		this._statusBarItem = null; // 状态栏项目
		this._opacity = 100; // 状态栏透明度，默认100%
		this._statusBarVisible = true; // 状态栏文字显示状态，默认显示
		this._storageManager = new StorageManager(context); // 存储管理器
		this._saveDebounceTimer = null; // 防抖定时器
		this._isRestoring = false; // 是否正在恢复数据
		
		// 章节预览功能组件
		this._altKeyManager = new AltKeyManager(); // Alt键状态管理器（保留用于兼容性）
		this._scrollHandler = new ScrollWheelHandler(this); // 滚轮滚动处理器（保留用于兼容性）
		this._floatingWindowManager = new FloatingWindowManager(context, this, this._scrollHandler); // 悬浮窗管理器
		this._mouseEventListener = new MouseEventListener(this._altKeyManager, this._floatingWindowManager, this, this._scrollHandler); // 鼠标事件监听器（保留用于兼容性）
		
		this._loadOpacity(); // 从配置中加载透明度
		this._initStatusBar();
		// 移除旧的悬停功能初始化，新功能直接集成到状态栏按钮中
		this._restoreData(); // 恢复数据
	}

	/**
	 * 初始化状态栏
	 */
	_initStatusBar() {
		this._statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
		this._statusBarItem.text = "reader: 准备就绪 📖";
		this._statusBarItem.tooltip = '点击显示/隐藏章节预览 • 使用 Alt + 方向键滚动文字';
		this._statusBarItem.command = 'thief-reader.toggleChapterPreview'; // 设置点击命令
		this._statusBarItem.show();
		this._context.subscriptions.push(this._statusBarItem);
	}

	/**
	 * 切换章节预览
	 */
	toggleChapterPreview() {
		this._floatingWindowManager.toggleChapterPreview();
	}

	/**
	 * 初始化悬停功能（已废弃，保留用于兼容性）
	 */
	_initHoverFeature() {
		// 功能已整合到状态栏按钮和章节预览中
		console.log('章节预览功能已就绪');
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
				this._statusBarItem.text = "reader: 准备就绪";
				// 确保弹窗在首次启动时是关闭的
				if (this._floatingWindowManager.isVisible()) {
					this._floatingWindowManager.hide();
				}
				this._isRestoring = false;
				return;
			}
			
			// 有数据需要恢复时才显示恢复中的提示
			this._statusBarItem.text = "reader: 正在恢复数据...";
			
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
						lastReadTime: savedFile.lastReadTime ?? null,
						// 恢复章节位置映射
						chapterPositions: savedFile.chapterPositions || {}
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
							lastReadTime: savedFile.lastReadTime ?? null,
							chapterPositions: savedFile.chapterPositions || {}
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
								// 恢复章节位置映射
								fileInfo.chapterPositions = savedFile.chapterPositions || {};
								
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
								lastReadTime: savedFile.lastReadTime ?? null,
								chapterPositions: savedFile.chapterPositions || {}
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
			this._files = restoredFiles;
			
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
			
			// 确保弹窗在启动时是关闭的
			if (this._floatingWindowManager.isVisible()) {
				this._floatingWindowManager.hide();
			}
			
			this._isRestoring = false;
		} catch (error) {
			console.error('恢复数据失败:', error);
			vscode.window.showErrorMessage('恢复阅读数据失败: ' + error.message);
			this._statusBarItem.text = "reader: 准备就绪";
			// 确保弹窗在出错时也是关闭的
			if (this._floatingWindowManager.isVisible()) {
				this._floatingWindowManager.hide();
			}
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
				this._statusBarItem.text = "reader: 准备就绪";
				return;
			}
			
			// 查找文件
			const file = this._files.find(f => f.id === state.currentFileId);
			
			if (!file) {
				// 文件已被删除
				this._statusBarItem.text = "reader: 准备就绪";
				return;
			}
			
			if (file.status === 'missing' || file.status === 'error') {
				// 文件不可用
				vscode.window.showWarningMessage(
					`上次阅读的文件 "${file.name}" 无法加载，请重新选择文件`
				);
				this._statusBarItem.text = "reader: 准备就绪";
				return;
			}
			
			// 恢复选择
			this._currentFile = file;
			
			// 使用文件自己保存的阅读位置
			this._restoreFileReadingPosition(file);
			
			// 显示内容
			if (this._currentChapter !== null && file.chapters && file.chapters.length > 0) {
				const chapter = file.chapters[this._currentChapter];
				this._displayChapterText(chapter);
			} else {
				this._statusBarItem.text = `reader: 已恢复 ${file.name}`;
			}
			
			// 确保弹窗在恢复后是关闭的
			if (this._floatingWindowManager.isVisible()) {
				this._floatingWindowManager.hide();
			}
		} catch (error) {
			console.error('恢复阅读状态失败:', error);
			this._statusBarItem.text = "reader: 准备就绪";
			// 确保弹窗在出错时也是关闭的
			if (this._floatingWindowManager.isVisible()) {
				this._floatingWindowManager.hide();
			}
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
		const validFiles = this._files.filter(
			f => f.status !== 'missing' && f.status !== 'error'
		);
		
		const removedCount = this._files.length - validFiles.length;
		this._files = validFiles;
		
		// 如果当前文件被清理了，清空选择
		if (this._currentFile && (this._currentFile.status === 'missing' || this._currentFile.status === 'error')) {
			this._currentFile = null;
			this._currentChapter = null;
			this._scrollOffset = 0;
			this._statusBarItem.text = "reader: 准备就绪";
		}
		
		this._saveCurrentState();
		this._refreshView();
		
		vscode.window.showInformationMessage(`已清理 ${removedCount} 个失效文件`);
	}

	/**
	 * 格式化时间戳
	 * @param {number} timestamp - 时间戳
	 * @returns {string} - 格式化后的时间字符串 YYYY-MM-DD HH:mm:ss
	 */
	_formatTimestamp(timestamp) {
		const date = new Date(timestamp);
		const year = date.getFullYear();
		const month = String(date.getMonth() + 1).padStart(2, '0');
		const day = String(date.getDate()).padStart(2, '0');
		const hours = String(date.getHours()).padStart(2, '0');
		const minutes = String(date.getMinutes()).padStart(2, '0');
		const seconds = String(date.getSeconds()).padStart(2, '0');
		
		return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
	}

	/**
	 * 为粘贴内容生成友好的文件名
	 * @param {string} content - 粘贴的文本内容
	 * @returns {string} - 格式化的文件名
	 */
	_generatePasteFileName(content) {
		// 1. 清理文本（去除多余空白和换行）
		const cleanContent = content.trim().replace(/\s+/g, ' ');
		
		// 2. 提取前10个字符
		const preview = cleanContent.substring(0, 10);
		
		// 3. 生成时间戳
		const timestamp = Date.now();
		const formattedTime = this._formatTimestamp(timestamp);
		
		// 4. 组合文件名
		if (preview.length === 0) {
			return `[粘贴内容]（空）（${formattedTime}）`;
		} else if (cleanContent.length > 10) {
			return `[粘贴内容]${preview}...（${formattedTime}）`;
		} else {
			return `[粘贴内容]${preview}（${formattedTime}）`;
		}
	}

	/**
	 * 保存文件的阅读位置
	 */
	_saveFileReadingPosition(fileId) {
		if (!fileId) return;
		
		const file = this._files.find(f => f.id === fileId);
		if (!file) return;
		
		// 更新文件的阅读位置
		file.lastChapter = this._currentChapter;
		file.lastScrollOffset = this._scrollOffset;
		file.lastReadTime = Date.now();
	}

	/**
	 * 保存当前章节的滚动位置
	 */
	_saveChapterPosition(chapterIndex, scrollOffset) {
		if (!this._currentFile || chapterIndex === null || chapterIndex === undefined) return;
		
		// 初始化 chapterPositions（如果不存在）
		if (!this._currentFile.chapterPositions) {
			this._currentFile.chapterPositions = {};
		}
		
		// 保存章节位置
		this._currentFile.chapterPositions[chapterIndex] = scrollOffset;
	}

	/**
	 * 获取章节的保存位置
	 */
	_getChapterPosition(chapterIndex) {
		if (!this._currentFile || chapterIndex === null || chapterIndex === undefined) {
			return 0;
		}
		
		// 如果没有 chapterPositions 或该章节没有保存位置，返回0
		if (!this._currentFile.chapterPositions) {
			return 0;
		}
		
		return this._currentFile.chapterPositions[chapterIndex] ?? 0;
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
		if (this._currentFile) {
			this._saveFileReadingPosition(this._currentFile.id);
		}
		
		// 清除之前的定时器
		if (this._saveDebounceTimer) {
			clearTimeout(this._saveDebounceTimer);
		}
		
		// 设置新的定时器（500ms 后保存）
		this._saveDebounceTimer = setTimeout(async () => {
			try {
				// 保存文件列表（包含每个文件的阅读位置）
				await this._storageManager.saveFiles(this._files);
				
				// 保存当前选中的文件ID
				if (this._currentFile) {
					await this._storageManager.saveReadingState({
						currentFileId: this._currentFile.id
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
						await this._selectFile();
						break;
					case 'selectFile':
						await this._selectFileFromList(message.fileId);
						break;
					case 'selectChapter':
						await this._selectChapter(message.chapterId);
						break;
					case 'removeFile':
						this._removeFile(message.fileId);
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
		const fileListHtml = this._files.map(file => {
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
				<div class="file-item ${this._currentFile && this._currentFile.id === file.id ? 'active' : ''} ${isDisabled ? 'disabled' : ''}" 
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

		const chapterListHtml = this._currentFile && this._currentFile.chapters ? 
			this._currentFile.chapters.map((chapter, index) => `
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
					case 'updateChapterHighlight':
						updateChapterHighlightUI(message.chapterIndex);
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

			/**
			 * 更新章节高亮UI（不刷新整个页面，避免滚动位置重置）
			 */
			function updateChapterHighlightUI(chapterIndex) {
				// 移除所有章节的 active 类
				const chapterItems = document.querySelectorAll('.chapter-item');
				chapterItems.forEach(item => {
					item.classList.remove('active');
				});
				
				// 添加 active 类到选中的章节
				const selectedChapter = document.querySelector(\`.chapter-item[data-chapter-id="\${chapterIndex}"]\`);
				if (selectedChapter) {
					selectedChapter.classList.add('active');
					
					// 自动滚动到选中的章节（smooth 平滑滚动）
					selectedChapter.scrollIntoView({ 
						behavior: 'smooth',  // 平滑滚动动画
						block: 'nearest',    // 如果已经可见，不滚动；否则滚动到最近的边缘
						inline: 'nearest'
					});
				}
			}
		</script>
	</body>
	</html>`;
	}

	/**
	 * 选择文件（支持PDF、TXT和EPUB）
	 */
	async _selectFile() {
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
			
			this._statusBarItem.text = `reader: 正在解析 ${fileName}...`;
			
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
				lastReadTime: null,
				// 初始化章节位置映射
				chapterPositions: {}
			};

			// 检查是否已存在相同路径的文件（按路径检查，不是文件名）
			const existingIndex = this._files.findIndex(f => f.path === filePath);
			if (existingIndex !== -1) {
				// 找到相同路径的文件，询问用户是否重新加载
				const oldFile = this._files[existingIndex];
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
					fileInfo.chapterPositions = oldFile.chapterPositions || {};
					
					// 验证章节索引是否仍然有效
					if (fileInfo.lastChapter !== null && fileInfo.lastChapter >= fileInfo.chapters.length) {
						fileInfo.lastChapter = 0;
						fileInfo.lastScrollOffset = 0;
						vscode.window.showInformationMessage(
							`文件内容已变化，阅读位置已重置到开头`
						);
					}
					
					this._files[existingIndex] = fileInfo;
					this._statusBarItem.text = `reader: 已重新加载 ${fileName}`;
					vscode.window.showInformationMessage(`成功重新加载${fileInfo.type}文件: ${fileName}`);
				} else {
					// 用户取消，不做任何操作
					this._statusBarItem.text = `reader: 取消加载`;
					return;
				}
			} else {
				// 新文件，直接添加
				this._files.push(fileInfo);
				this._statusBarItem.text = `reader: 已加载 ${fileName}`;
				vscode.window.showInformationMessage(`成功加载${fileInfo.type}文件: ${fileName}`);
			}
			
			// 保存状态
			this._saveCurrentState();
			
			// 刷新界面
			this._refreshView();
		} catch (error) {
			this._statusBarItem.text = "reader: 加载失败";
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
			this._statusBarItem.text = "reader: 正在解析粘贴内容...";
			
			// 解析章节
			const chapters = this._extractChaptersWithFallback(content);
			
			// 生成友好的文件名
			const fileName = this._generatePasteFileName(content);
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
				lastReadTime: null,
				// 初始化章节位置映射
				chapterPositions: {}
			};

			// 添加到文件列表
			this._files.push(fileInfo);
			
			// 自动选中这个文件
			this._currentFile = fileInfo;
			this._currentChapter = chapters.length > 0 ? 0 : null;
			this._currentPage = 0;
			this._scrollOffset = 0;

			this._statusBarItem.text = `reader: 已加载粘贴内容`;
			vscode.window.showInformationMessage(`成功加载粘贴内容，共${chapters.length}个章节`);
			
			// 保存状态
			this._saveCurrentState();
			
			// 刷新界面
			this._refreshView();
		} catch (error) {
			this._statusBarItem.text = "reader: 加载失败";
			vscode.window.showErrorMessage(`加载粘贴内容失败: ${error.message}`);
		}
	}

	/**
	 * 提取章节信息（带备用方案）
	 */
	_extractChaptersWithFallback(text) {
		// 先尝试正常的章节提取
		const chapters = this._extractChapters(text);
		
		// 如果成功提取到章节，直接返回
		if (chapters.length > 0) {
			return chapters;
		}
		
		// 如果没有识别出章节，使用 Fallback 方案
		// 按段落分割，每段用前10个字作为标题
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
			const lines = text.split('\n').filter(line => line.trim().length > 0);
			
			if (lines.length === 0) {
				// 场景1：完全空内容
				const cleanContent = text.trim().replace(/\s+/g, ' ');
				if (cleanContent.length === 0) {
					// 空内容
					chapters.push({
						title: '（空内容）',
						startLine: 0,
						content: []
					});
				} else {
					// 有内容但太短（小于10个字符）
					const title = cleanContent.substring(0, 10);
					chapters.push({
						title: title || '（空内容）',
						startLine: 0,
						content: [cleanContent]
					});
				}
			} else {
				// 场景2：有行但没有段落分隔符
				lines.forEach((line) => {
					const trimmedLine = line.trim();
					// 取前10个字符作为标题
					const title = trimmedLine.substring(0, 10) + (trimmedLine.length > 10 ? '...' : '');
					
					chapters.push({
						title: title || '（无标题）',
						startLine: 0,
						content: [trimmedLine]
					});
				});
			}
		} else {
			// 场景3：有段落分隔符，按段落分割
			paragraphs.forEach((paragraph) => {
				const lines = paragraph.split('\n').filter(line => line.trim().length > 0);
				if (lines.length > 0) {
					const firstLine = lines[0].trim();
					// 取前10个字符作为标题
					const title = firstLine.substring(0, 10) + (firstLine.length > 10 ? '...' : '');
					
					chapters.push({
						title: title || '（无标题）',
						startLine: 0,
						content: lines
					});
				}
			});
		}
		
		// 最终兜底：确保至少有一个章节
		if (chapters.length === 0) {
			chapters.push({
				title: '（空内容）',
				startLine: 0,
				content: []
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
			}
		}

		// 添加最后一个章节
		if (currentChapter) {
			chapters.push(currentChapter);
		}

		// 如果没有检测到章节，返回空数组
		// 让调用者使用 _extractChaptersWithFallback 来处理
		return chapters;
	}

	/**
	 * 从列表中选择文件
	 */
	async _selectFileFromList(fileId) {
		const file = this._files.find(f => f.id === fileId);
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
		if (this._currentFile && this._currentFile.id !== fileId) {
			this._saveFileReadingPosition(this._currentFile.id);
		}
		
		// 步骤2：切换到新文件
		this._currentFile = file;
		
		// 步骤3：恢复新文件的阅读位置
		this._restoreFileReadingPosition(file);
		
		// 步骤4：显示内容
		if (this._currentChapter !== null && file.chapters && file.chapters.length > 0) {
			const chapter = file.chapters[this._currentChapter];
			this._displayChapterText(chapter);
			// _displayChapterText 已经设置了完整的状态栏文本（包括章节标题、滚动位置、具体文字）
			
			// 步骤5：切换文件时自动隐藏章节预览弹窗（在更新显示后）
			if (this._floatingWindowManager.isVisible()) {
				this._floatingWindowManager.hide();
				// 隐藏弹窗后立即刷新状态栏，确保图标正确更新为📖
				setTimeout(() => {
					this._displayChapterText(chapter);
				}, 50);
			}
		} else {
			this._statusBarItem.text = `reader: 已选择 ${file.name} [${file.type}]`;
			
			// 如果没有章节内容，也要隐藏弹窗
			if (this._floatingWindowManager.isVisible()) {
				this._floatingWindowManager.hide();
			}
		}
		
		// 步骤6：保存状态并刷新界面
		this._saveCurrentState();
		this._refreshView();
	}

	/**
	 * 选择章节
	 */
	async _selectChapter(chapterId) {
		if (!this._currentFile || !this._currentFile.chapters) return;

		const chapterIndex = parseInt(chapterId);
		if (chapterIndex >= 0 && chapterIndex < this._currentFile.chapters.length) {
			// 步骤1：保存当前章节的滚动位置
			if (this._currentChapter !== null && this._currentChapter !== chapterIndex) {
				this._saveChapterPosition(this._currentChapter, this._scrollOffset);
			}
			
			// 步骤2：切换到新章节
			this._currentChapter = chapterIndex;
			this._currentPage = 0;
			
			// 步骤3：恢复新章节的滚动位置
			this._scrollOffset = this._getChapterPosition(chapterIndex);
			
			// 步骤4：显示内容
			const chapter = this._currentFile.chapters[chapterIndex];
			this._displayChapterText(chapter);
			this._saveCurrentState();
			
			// 步骤5：切换章节时自动隐藏章节预览弹窗（在更新显示后）
			if (this._floatingWindowManager.isVisible()) {
				this._floatingWindowManager.hide();
				// 隐藏弹窗后立即刷新状态栏，确保图标正确更新为📖
				setTimeout(() => {
					this._displayChapterText(chapter);
				}, 50);
			}
			
			// 通过消息更新章节高亮，而不是刷新整个视图（避免滚动位置重置）
			this._updateChapterHighlight(chapterIndex);
		}
	}

	/**
	 * 更新章节高亮（通过消息机制，不刷新整个视图）
	 */
	_updateChapterHighlight(chapterIndex) {
		if (this._view) {
			this._view.webview.postMessage({
				command: 'updateChapterHighlight',
				chapterIndex: chapterIndex
			});
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

		// 检查预览窗口是否显示
		const previewStatus = this._floatingWindowManager.isVisible() ? '🔍' : '📖';
		
		// 更新状态栏文本和图标
		this._statusBarItem.text = `reader: ${chapter.title}${scrollIndicator} - ${displayContent} ${previewStatus}`;
		
		console.log(`状态栏已更新: ${chapter.title} 偏移量${this._scrollOffset} 预览状态${previewStatus}`);
	}

	/**
	 * 删除文件
	 */
	_removeFile(fileId) {
		const index = this._files.findIndex(f => f.id === fileId);
		if (index !== -1) {
			const file = this._files[index];
			const fileName = file.name;
			const fileType = file.type;
			this._files.splice(index, 1);
			
			// 如果删除的是当前选中的文件，清空选择
			if (this._currentFile && this._currentFile.id === fileId) {
				this._currentFile = null;
				this._currentChapter = null;
				this._currentPage = 0;
				this._scrollOffset = 0;
				this._statusBarItem.text = "reader: 准备就绪";
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
		if (this._currentChapter !== null && this._currentFile) {
			const jumpSize = 80; // 跳转一个显示窗口的大小
			
			if (this._scrollOffset > 0) {
				this._scrollOffset = Math.max(0, this._scrollOffset - jumpSize);
				const chapter = this._currentFile.chapters[this._currentChapter];
				this._displayChapterText(chapter);
				// 保存当前章节位置
				this._saveChapterPosition(this._currentChapter, this._scrollOffset);
				this._saveCurrentState();
			}
		}
	}

	/**
	 * 下一页 (Alt + Shift + 右方向键) - 快速向后跳转80个字符
	 */
	_nextPage() {
		if (this._currentChapter !== null && this._currentFile) {
			const chapter = this._currentFile.chapters[this._currentChapter];
			const fullContent = chapter.content.join(' ');
			const jumpSize = 80; // 跳转一个显示窗口的大小
			const maxScrollOffset = Math.max(0, fullContent.length - 1);
			
			if (this._scrollOffset < maxScrollOffset) {
				this._scrollOffset = Math.min(maxScrollOffset, this._scrollOffset + jumpSize);
				this._displayChapterText(chapter);
				// 保存当前章节位置
				this._saveChapterPosition(this._currentChapter, this._scrollOffset);
				this._saveCurrentState();
			}
		}
	}

	/**
	 * 向左滑动 (Alt + 左方向键) - 在整个章节中向左滑动
	 */
	_scrollLeft() {
		if (this._currentChapter !== null && this._currentFile) {
			const scrollStep = 10; // 每次滑动10个字符
			
			if (this._scrollOffset > 0) {
				this._scrollOffset = Math.max(0, this._scrollOffset - scrollStep);
				const chapter = this._currentFile.chapters[this._currentChapter];
				this._displayChapterText(chapter);
				// 保存当前章节位置
				this._saveChapterPosition(this._currentChapter, this._scrollOffset);
				this._saveCurrentState();
			}
		}
	}

	/**
	 * 向右滑动 (Alt + 右方向键) - 在整个章节中向右滑动
	 */
	_scrollRight() {
		if (this._currentChapter !== null && this._currentFile) {
			const scrollStep = 10; // 每次滑动10个字符
			const chapter = this._currentFile.chapters[this._currentChapter];
			const fullContent = chapter.content.join(' ');
			const maxScrollOffset = Math.max(0, fullContent.length - 1);
			
			if (this._scrollOffset < maxScrollOffset) {
				this._scrollOffset = Math.min(maxScrollOffset, this._scrollOffset + scrollStep);
				this._displayChapterText(chapter);
				// 保存当前章节位置
				this._saveChapterPosition(this._currentChapter, this._scrollOffset);
				this._saveCurrentState();
			}
		}
	}

	/**
	 * 切换状态栏文字的显示/隐藏 (Shift + 空格键)
	 */
	_toggleStatusBarVisibility() {
		// 新功能：切换章节预览显示
		this.toggleChapterPreview();
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
		if (this._statusBarItem && this._currentChapter !== null && this._currentFile) {
			const chapter = this._currentFile.chapters[this._currentChapter];
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

	// 章节预览功能的切换命令
	const toggleChapterPreviewCommand = vscode.commands.registerCommand('thief-reader.toggleChapterPreview', function () {
		provider.toggleChapterPreview();
	});

	const showHoverPreviewCommand = vscode.commands.registerCommand('thief-reader.showHoverPreview', function () {
		// 直接显示悬停预览（用于测试）
		if (provider._currentFile && provider._currentChapter !== null) {
			const content = provider._mouseEventListener._getCurrentReaderContent();
			if (content) {
				provider._floatingWindowManager.showAt(content);
				vscode.window.showInformationMessage('悬停预览已显示');
			} else {
				vscode.window.showWarningMessage('没有可预览的内容');
			}
		} else {
			vscode.window.showWarningMessage('请先加载文件');
		}
	});

	const hideHoverPreviewCommand = vscode.commands.registerCommand('thief-reader.hideHoverPreview', function () {
		// 隐藏悬停预览
		provider._floatingWindowManager.hide();
		vscode.window.showInformationMessage('悬停预览已隐藏');
	});

	context.subscriptions.push(disposable);
	context.subscriptions.push(toggleChapterPreviewCommand);
	context.subscriptions.push(showHoverPreviewCommand);
	context.subscriptions.push(hideHoverPreviewCommand);
}

// 当您的扩展被停用时调用此方法
function deactivate() {}

module.exports = {
	activate,
	deactivate
}
