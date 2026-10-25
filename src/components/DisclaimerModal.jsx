export function DisclaimerModal({ onClose }) {
  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <section
        className="disclaimer-modal"
        data-analytics-component="免责声明"
        role="dialog"
        aria-modal="true"
        aria-labelledby="disclaimer-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="disclaimer-modal-heading">
          <h2 id="disclaimer-title">数据说明与隐私</h2>
          <button type="button" className="modal-close" aria-label="关闭免责声明" onClick={onClose}>
            ×
          </button>
        </header>
        <div className="disclaimer-modal-content">
          <h3>数据说明与免责声明</h3>
          <p>
            本站为非营利性网站。聚势（FINETECH）提供电视剧与综艺信息查询、多平台指标整理、同期分析及趋势可视化，具体数据来源以页面标注为准。本站不参与原始数据生产，也不参与各来源平台统计口径的制定；指标含义、计算方式及适用范围以来源平台的说明为准。
          </p>
          <p>
            不同平台的热度、播放量、收视率等指标具有各自的统计口径，不能直接等同或简单相加。本站的图表与分析结果用于辅助观察剧集表现，不代表统一的行业评价标准，也不构成对作品商业价值、市场排名或未来收益的保证。
          </p>
          <p>
            受来源平台更新、历史覆盖范围及采集状态等因素影响，本站数据可能存在延迟、缺失或错误，历史数据也可能随来源平台修订而变化。涉及研究、传播或商业决策时，请结合采集时间、来源说明及原始页面核实。
          </p>
          <p>
            相关影视作品、图片、平台标识及其他第三方内容的合法权益归相应权利人享有。本站独立运营，除另有明确说明外，与相关平台及权利人无官方合作或隶属关系。浏览或下载本站内容，不代表获得相关内容的再发布、销售或其他使用授权。
          </p>
          <p>
            如发现数据错误、来源标注不当或涉嫌侵权的内容，请通过首页小红书图标联系本站，并提供对应页面及问题说明。本站将核实并根据情况更正、移除或采取其他必要措施。
          </p>
          <h3>隐私说明</h3>
          <p>本站会处理搜索关键词、看板操作参数，并记录访问页面、功能点击、随机访客标识及必要的请求日志（可能包含IP地址），用于提供服务、使用分析与安全维护。看板状态保存在浏览器中，统计事件约保存365天。您可清除浏览器中的本站数据；如需查阅、更正或删除相关个人信息，请通过首页小红书图标联系本站。</p>
        </div>
      </section>
    </div>
  )
}
