package cc.stellarformation.mememeow.android;

import com.getcapacitor.BridgeActivity;
import android.os.Bundle;

/** 加载配置的网站，并由 Capacitor 管理插件和系统照片选择器。 */
public class MainActivity extends BridgeActivity {
    /** 在创建网页之前注册凭据插件，保证登录页面可识别安全存储能力。 */
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(CredentialsPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
