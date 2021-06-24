let body = $response.body;
let url = $request.url;

console.log('url=' + url)
console.log('body=' + body)

body = body.replace("UDown", 'XXXXXXXXX'); // 使重定向判断条件失效
let clearJS = `<script type="text/javascript">
$(function(){
    function actionSheetAction(index) {
        if (index == 4) { return; }
        $.ajax({
            url: '/web/lixian/?ct=lixian&ac=task_clear',
            dataType: 'json',
            data: {flag: index},
            type: 'POST',
            cache: false,
            success: function (r) {
                window.location.reload();
            },
            error: function(){
                console.log('清空失败');
            }
        });
    }
    function clearAction() { 
        OOFJS.common.actionSheet('选择清空的操作', ['清空已完成任务', '清空全部任务', '清空失败任务', '清空进行中任务'], actionSheetAction);
    }
    setTimeout(function(){OOFJS.common.addRightBarItem('清空', clearAction);}, 200);
});
</script>`
body = body.replace("</body>", clearJS + '\n</body>'); // 注入清空任务相关JS

$done({body});