export async function checkAttendanceInPage(args) {
  const TARGET_COURSE_NAME = args?.targetCourseName || "";
  const TARGET_DATE = args?.targetDate || "";
  const TARGET_KOMA = Number(args?.targetKoma || 0);

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function result(status, message, extra = {}) {
    return {
      status,
      message,
      lessonText: extra.lessonText || "",
      buttonText: extra.buttonText || "",
      debug: extra.debug || {}
    };
  }

  function textOf(el) {
    return (el?.textContent || "").replace(/\s+/g, " ").trim();
  }

  function normalizeDate(value) {
    return String(value || "").replaceAll("-", "/").trim();
  }

  function isVisible(el) {
    if (!el) return false;
    const win = el.ownerDocument.defaultView;
    const style = win.getComputedStyle(el);
    return (
      el.getClientRects().length > 0 &&
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      style.opacity !== "0"
    );
  }

  function activateElement(el, label) {
    if (!el) {
      throw new Error(`${label} が見つかりません`);
    }
    if (el.matches?.("button.js-subject-lesson-attend, button.js-subject-lesson-attended")) {
      throw new Error("出席ボタンは操作しません。");
    }

    el.scrollIntoView({ block: "center", inline: "center" });
    const win = el.ownerDocument.defaultView;

    el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: win }));
    el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: win }));
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: win }));
  }

  function looksLikeLoginPage() {
    const pageText = textOf(document.body);
    const hasPassword = Boolean(document.querySelector('input[type="password"]'));
    const hasLoginForm = Boolean(document.querySelector('form[action*="login" i], form[action*="sso" i]'));
    const url = location.href.toLowerCase();
    return (
      hasPassword ||
      hasLoginForm ||
      url.includes("login") ||
      url.includes("sso") ||
      pageText.includes("ログインしてください") ||
      pageText.includes("ログインが必要") ||
      pageText.includes("シングルサインオン")
    );
  }

  async function waitFor(getter, label, timeout = 15000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const value = getter();
      if (value) return value;
      await sleep(250);
    }
    throw new Error(`${label} が見つかりませんでした`);
  }

  function findCourseCell(courseName) {
    const candidates = [];

    for (const row of document.querySelectorAll("tr")) {
      const dataName = row.getAttribute("data-name") || "";
      const rowText = textOf(row);
      if (dataName.includes(courseName) || rowText.includes(courseName)) {
        candidates.push(row.querySelector("td.clickable") || row);
      }
    }

    if (candidates.length > 0) {
      return candidates[0];
    }

    for (const el of document.querySelectorAll("a, button, td, div, span")) {
      const dataName = el.getAttribute("data-name") || "";
      const elText = textOf(el);
      if (dataName.includes(courseName) || elText.includes(courseName)) {
        return el;
      }
    }

    return null;
  }

  function findActiveModal() {
    const modals = [...document.querySelectorAll(".modal")];
    const visibleModals = modals.filter((modal) => {
      const style = getComputedStyle(modal);
      return (
        style.display === "block" ||
        modal.classList.contains("show") ||
        modal.classList.contains("in") ||
        isVisible(modal)
      );
    });
    return visibleModals.at(-1) || null;
  }

  function findLessonTabInModal(modal) {
    if (!modal) return null;

    const selectorCandidates = [
      ...modal.querySelectorAll(
        'a[data-toggle="tab"][data-value="lesson"], a[data-value="lesson"], ' +
          '[data-toggle="tab"][data-value="lesson"], [data-value="lesson"], ' +
          'a[href*="lesson"], [role="tab"]'
      )
    ].filter(isVisible);

    if (selectorCandidates.length > 0) {
      return selectorCandidates[0];
    }

    const textCandidates = [...modal.querySelectorAll('a, button, [role="tab"], [data-toggle="tab"]')]
      .filter(isVisible)
      .filter((el) => textOf(el) === "授業" || textOf(el).includes("授業"));

    return textCandidates[0] || null;
  }

  function collectNodeCandidatesFromModal(modal) {
    if (!modal) return [];

    return [...modal.querySelectorAll('a[href^="#node"]')].map((a, index) => ({
      index,
      text: textOf(a),
      href: a.getAttribute("href") || "",
      title: a.getAttribute("data-original-title") || a.getAttribute("title") || "",
      html: a.outerHTML || "",
      element: a
    }));
  }

  function findNodesByDate(modal, targetDate) {
    const normalizedTargetDate = normalizeDate(targetDate);
    return collectNodeCandidatesFromModal(modal).filter((node) => {
      const text = normalizeDate(node.text);
      const title = normalizeDate(node.title);
      const html = normalizeDate(node.html);
      return (
        text.includes(normalizedTargetDate) ||
        title.includes(normalizedTargetDate) ||
        html.includes(normalizedTargetDate)
      );
    });
  }

  async function waitForNodeCandidates(modal, timeout = 15000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const nodes = collectNodeCandidatesFromModal(modal);
      if (nodes.length > 0) return nodes;
      await sleep(300);
    }
    return [];
  }

  function getAttendanceState(root) {
    if (!root) {
      return { state: "not_found", count: 0 };
    }

    const attendedButtons = [...root.querySelectorAll("button.js-subject-lesson-attended")]
      .filter(isVisible)
      .filter((btn) => textOf(btn).includes("出席済み"));

    if (attendedButtons.length > 0) {
      return {
        state: "attended",
        button: attendedButtons[0],
        count: attendedButtons.length
      };
    }

    const attendButtons = [...root.querySelectorAll("button.js-subject-lesson-attend")]
      .filter(isVisible)
      .filter((btn) => textOf(btn).includes("出席する"));

    if (attendButtons.length > 0) {
      return {
        state: "need_attend",
        buttons: attendButtons,
        count: attendButtons.length
      };
    }

    return { state: "not_found", count: 0 };
  }

  function findAttendanceState(roots) {
    for (const root of roots) {
      const state = getAttendanceState(root);
      if (state.state !== "not_found") return state;
    }
    return { state: "not_found", count: 0 };
  }

  async function waitForAttendanceState(rootsGetter, timeout = 2200) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const state = findAttendanceState(rootsGetter());
      if (state.state !== "not_found") return state;
      await sleep(120);
    }
    return findAttendanceState(rootsGetter());
  }

  function isDisabledButton(button) {
    const className = button.getAttribute("class") || "";
    const disabledAttr = button.getAttribute("disabled");
    const ariaDisabled = button.getAttribute("aria-disabled");
    return (
      className.split(/\s+/).includes("disabled") ||
      disabledAttr !== null ||
      ariaDisabled === "true" ||
      !button.matches(":enabled")
    );
  }

  try {
    if (looksLikeLoginPage()) {
      return result("login_required", "ヨリソルにログインしてください");
    }

    if (!TARGET_COURSE_NAME) {
      return result("course_not_found", "対象授業名が空です。");
    }

    if (!TARGET_DATE) {
      return result("node_not_found", "対象日付が空です。");
    }

    if (!Number.isInteger(TARGET_KOMA) || TARGET_KOMA < 1) {
      return result("node_not_found", `targetKoma が不正です: ${TARGET_KOMA}`);
    }

    const courseCell = await waitFor(
      () => findCourseCell(TARGET_COURSE_NAME),
      `授業名「${TARGET_COURSE_NAME}」の科目行`,
      15000
    ).catch(() => null);

    if (!courseCell) {
      return result("course_not_found", "対象授業が見つかりません。");
    }

    activateElement(courseCell, `授業「${TARGET_COURSE_NAME}」`);

    const modal = await waitFor(
      () => findActiveModal(),
      "表示中の授業モーダル",
      15000
    ).catch(() => null);

    if (!modal) {
      return result("error", "授業モーダルが見つかりませんでした。");
    }

    await sleep(700);

    const lessonTab = await waitFor(
      () => findLessonTabInModal(modal),
      "モーダル内の授業タブ",
      15000
    ).catch(() => null);

    if (!lessonTab) {
      return result("error", "モーダル内の授業タブが見つかりませんでした。");
    }

    activateElement(lessonTab, "モーダル内の授業タブ");

    const allNodes = await waitForNodeCandidates(modal, 15000);
    if (allNodes.length === 0) {
      return result("node_not_found", "授業タブ内のnodeリンクが0件です。");
    }

    const sameDateNodes = findNodesByDate(modal, TARGET_DATE);
    if (sameDateNodes.length === 0) {
      return result("node_not_found", "対象日付のnode候補が見つかりません。");
    }

    if (sameDateNodes.length < TARGET_KOMA) {
      return result(
        "node_not_found",
        `${TARGET_DATE} のnode候補は ${sameDateNodes.length} 件です。${TARGET_KOMA}件目に対応するnodeを選べません。`,
        { debug: { candidateCount: sameDateNodes.length, targetKoma: TARGET_KOMA } }
      );
    }

    const targetNode = sameDateNodes[TARGET_KOMA - 1];
    if (!targetNode?.element) {
      return result("node_not_found", "対象nodeを一意に選べませんでした。");
    }

    const targetNodeId = targetNode.href.replace("#", "");
    const lessonText = targetNode.text || targetNode.title || "";

    activateElement(targetNode.element, `${TARGET_DATE} ${TARGET_KOMA}件目 ${targetNode.href}`);

    const pane = await waitFor(
      () => modal.querySelector(`#${CSS.escape(targetNodeId)}`) || document.getElementById(targetNodeId),
      "対象node本文",
      1800
    ).catch(() => null);

    const searchRoots = [pane, modal].filter(Boolean);
    const attendance = await waitForAttendanceState(() => searchRoots, 2200);

    if (attendance.state === "attended") {
      return result("already_attended", "すでに出席済みです。", {
        lessonText,
        buttonText: textOf(attendance.button)
      });
    }

    if (attendance.state === "not_found") {
      return result("no_button", "出席ボタンも出席済み表示も見つかりませんでした。", {
        lessonText
      });
    }

    if (attendance.state !== "need_attend") {
      return result("error", "出席状態を判定できませんでした。", { lessonText });
    }

    if (attendance.count !== 1) {
      return result("multiple_buttons", "出席ボタンが複数あります。手動確認してください。", {
        lessonText,
        debug: { buttonCount: attendance.count }
      });
    }

    const button = attendance.buttons[0];
    const buttonText = textOf(button);

    if (isDisabledButton(button)) {
      return result("no_button", "出席ボタンが無効状態です。", {
        lessonText,
        buttonText
      });
    }

    if (!buttonText.includes("出席する")) {
      return result("error", "ボタン文言が想定外です。", {
        lessonText,
        buttonText
      });
    }

    return result("need_attend", "出席ボタンがあります。通知対象です。", {
      lessonText,
      buttonText
    });
  } catch (error) {
    return result("error", String(error?.message || error));
  }
}
