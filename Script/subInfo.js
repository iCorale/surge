(async () => {
    let params = getUrlParams($request.url);
    let info = await getUserInfo(params.url);
    console.log('info:' + info)
    if (!info) {
        $notification.post("subInfo", "", "链接响应头不带有流量信息")
        $done();
    }
    let usage = getDataUsage(info);
    let used = bytesToSize(usage.download + usage.upload);
    let total = bytesToSize(usage.total);
    let expire = usage.expire === undefined ? '' : '|' + formatTimestamp(usage.expire * 1000)
    let http = "http, localhost, 8888";
    let body = `${used}/${total}${expire} = ${http}`;
    $done({response: {body}});
})();

function getUrlParams(url) {
    return Object.fromEntries(url.slice(url.indexOf('?') + 1).split('&').map(item => item.split("=")).map(([k, v]) => [k, decodeURIComponent(v)]));
}

function getUserInfo(url) {
    return new Promise((resolve) => setTimeout(() => {
        $httpClient.get(url, (err, resp) => {
                if (err) $done();
                resolve(resp.headers[Object.keys(resp.headers).find((key) => key.toLowerCase() === "subscription-userinfo")]);
            })
    }, 500));
}

function getDataUsage(info) {
    return Object.fromEntries(info.match(/\w+=\d+/g).map(item => item.split("=")).map(([k, v]) => [k, parseInt(v)]));
}

function bytesToSize(bytes) {
    if (bytes === 0) return '0B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
    let i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + sizes[i];
}

function formatTimestamp(timestamp) {
    let date = new Date(timestamp + 8 * 3600 * 1000);
    return date.toJSON().substr(0, 10);
}