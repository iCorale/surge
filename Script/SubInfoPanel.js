let url = getUrlParams($argument).url;

$httpClient.head(url, (err, response) => {
    let info = getDataUsage(response.headers["subscription-userinfo"] || response.headers["Subscription-userinfo"]);
    console.log('info:' + info)
    let used = bytesToSize(info.download + info.upload);
    let total = bytesToSize(info.total);
    let expireTimestamp = info.expire * 1000;
    let expire = info.expire == undefined ? '' : formatTimestamp(expireTimestamp);
    let styleInfo = getStyleInfo(expireTimestamp);

    $done({
      title: 'DlerCloud',
      content: used + '/' + total + '|' + expire,
      style: styleInfo
  });
});


function getUrlParams(url) {
  return Object.fromEntries(
    url
      .split("&")
      .map((item) => item.split("="))
      .map(([k, v]) => [k, decodeURIComponent(v)])
  );
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
    // 8 * 3600 * 1000 = 28800000
    let date = new Date(timestamp + 28800000);
    return date.toJSON().substr(0, 10);
}

function getStyleInfo(timestamp) {
    // 7 * 24 * 3600 * 1000 = 604800000
    let compareTimestamp = 604800000;
    let nowTimestamp=new Date().getTime();
    let resultTimestamp = timestamp - nowTimestamp;
    return resultTimestamp < compareTimestamp ? "alert" : "good"
}