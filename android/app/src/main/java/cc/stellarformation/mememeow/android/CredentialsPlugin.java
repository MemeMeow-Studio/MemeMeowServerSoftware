package cc.stellarformation.mememeow.android;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Base64;
import android.util.Log;
import androidx.webkit.WebViewFeature;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.crypto.tink.Aead;
import com.google.crypto.tink.integration.android.AndroidKeystoreKmsClient;
import java.io.IOException;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import org.json.JSONArray;

/** Android 账号存储插件：按服务地址记录邮箱，使用 Keystore 与 Tink 保护密码。 */
@CapacitorPlugin(name = "MemeMeowCredentials")
public class CredentialsPlugin extends Plugin {
    private static final String STORE = "mememeow_credentials_v1";
    private static final String KEY_URI = "android-keystore://mememeow_saved_passwords_v1";
    private static final String PASSWORD_PREFIX = "password:";
    private boolean secureBridgeAvailable;

    /** 凭据只通过验证主页面来源的 WebView 接口传递，移除旧的 JavaScript 接口。 */
    @Override
    public void load() {
        secureBridgeAvailable = WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)
            && !getBridge().getConfig().isUsingLegacyBridge();
        if (secureBridgeAvailable) getBridge().getWebView().removeJavascriptInterface("androidBridge");
    }

    /** 拒绝未提供主页面验证能力的 WebView，以及配置来源以外的页面。 */
    private void requireTrustedPage() throws Exception {
        if (!secureBridgeAvailable) {
            throw new SecurityException("credentials_webview_unsupported: 请更新 Android System WebView");
        }
        if (!origin().equals(urlOrigin(getBridge().getWebView().getUrl()))) {
            throw new SecurityException("credentials_origin_not_allowed");
        }
    }

    /** 封装一次原生操作的返回值，让接口错误携带阶段与具体原因。 */
    private interface StorageOperation {
        JSObject run() throws Exception;
    }

    /** 只允许配置网站的主页面调用，并将存储故障报告给网页。 */
    private void execute(PluginCall call, String operation, StorageOperation action) {
        getBridge().executeOnMainThread(() -> {
            try {
                requireTrustedPage();
                getBridge().execute(() -> {
                    try {
                        JSObject result = action.run();
                        getBridge().executeOnMainThread(() -> {
                            try {
                                requireTrustedPage();
                                call.resolve(result);
                            } catch (Exception error) {
                                reject(call, operation, error);
                            }
                        });
                    } catch (Exception error) {
                        reject(call, operation, error);
                    }
                });
            } catch (Exception error) {
                reject(call, operation, error);
            }
        });
    }

    /** 向合法调用者报告原生阶段与系统异常，不记录调用参数。 */
    private void reject(PluginCall call, String operation, Exception error) {
        String message = "credentials_" + operation + "_failed: " + error.getClass().getSimpleName()
            + ": " + error.getMessage();
        Log.e("MemeMeowCredentials", message);
        getBridge().executeOnMainThread(() -> {
            String responseMessage = message;
            try {
                requireTrustedPage();
            } catch (Exception sourceError) {
                responseMessage = "credentials_" + operation + "_failed: " + sourceError.getClass().getSimpleName()
                    + ": " + sourceError.getMessage();
            }
            call.reject(responseMessage, "credentials_" + operation + "_failed");
        });
    }

    /** 规范化 URL 的来源；端口省略规则与浏览器的 origin 相同。 */
    private String urlOrigin(String value) throws Exception {
        URI uri = new URI(value);
        String scheme = uri.getScheme().toLowerCase(Locale.ROOT);
        String host = uri.getHost();
        if (host == null || uri.getRawUserInfo() != null
            || !(scheme.equals("https") || scheme.equals("http"))) {
            throw new SecurityException("credentials_origin_invalid");
        }
        int port = uri.getPort();
        boolean defaultPort = port == -1 || (scheme.equals("https") && port == 443)
            || (scheme.equals("http") && port == 80);
        return scheme + "://" + host.toLowerCase(Locale.ROOT) + (defaultPort ? "" : ":" + port);
    }

    /** 每次操作都检查实际页面来源，服务地址不由网页参数指定。 */
    private String origin() throws Exception {
        return urlOrigin(getBridge().getConfig().getServerUrl());
    }

    /** 读取应用私有记录；该文件不参与系统备份。 */
    private SharedPreferences preferences() {
        return getContext().getSharedPreferences(STORE, Context.MODE_PRIVATE);
    }

    /** 验证接口账号参数，不在错误消息中显示输入内容。 */
    private String email(PluginCall call) {
        String email = call.getString("email");
        if (email == null || !email.contains("@") || email.length() > 320) {
            throw new IllegalArgumentException("credentials_email_invalid");
        }
        return email;
    }

    /** 密文的保存位置也作为 Tink AAD，保证服务与账号之间不能互换密文。 */
    private String passwordKey(PluginCall call) throws Exception {
        return PASSWORD_PREFIX + origin() + "\n" + email(call);
    }

    /** 等待磁盘提交成功；空间或写入权限错误立即报告。 */
    private void commit(SharedPreferences.Editor editor) throws IOException {
        if (!editor.commit()) throw new IOException("credentials_disk_write_failed");
    }

    /** 返回当前服务的账号列表，首项为最近成功登录的账号。 */
    @PluginMethod
    public void list(PluginCall call) {
        execute(call, "list", () -> {
            String stored = preferences().getString("accounts:" + origin(), "[]");
            JSObject result = new JSObject();
            result.put("accounts", new JSONArray(stored));
            return result;
        });
    }

    /** 登录成功后更新账号记录，保留已有账号。 */
    @PluginMethod
    public void record(PluginCall call) {
        execute(call, "record", () -> {
            String email = email(call);
            String key = "accounts:" + origin();
            JSONArray current = new JSONArray(preferences().getString(key, "[]"));
            JSONArray accounts = new JSONArray();
            accounts.put(email);
            for (int index = 0; index < current.length(); index++) {
                String previous = current.getString(index);
                if (!email.equals(previous)) accounts.put(previous);
            }
            commit(preferences().edit().putString(key, accounts.toString()));
            return new JSObject();
        });
    }

    /** 读取选定账号的密码；未保存密码时返回 null，不创建新的加密密钥。 */
    @PluginMethod
    public void read(PluginCall call) {
        execute(call, "read", () -> {
            String key = passwordKey(call);
            String stored = preferences().getString(key, null);
            JSObject result = new JSObject();
            if (stored == null) {
                result.put("password", JSObject.NULL);
            } else {
                Aead encryption = new AndroidKeystoreKmsClient().getAead(KEY_URI);
                byte[] plaintext = encryption.decrypt(Base64.decode(stored, Base64.NO_WRAP),
                    key.getBytes(StandardCharsets.UTF_8));
                result.put("password", new String(plaintext, StandardCharsets.UTF_8));
            }
            return result;
        });
    }

    /** 由系统保管加密密钥，Tink 完成密码加密，成功提交后返回。 */
    @PluginMethod
    public void save(PluginCall call) {
        execute(call, "save", () -> {
            String key = passwordKey(call);
            String password = call.getString("password");
            if (password == null || password.isEmpty() || password.length() > 1024) {
                throw new IllegalArgumentException("credentials_password_invalid");
            }
            Aead encryption = AndroidKeystoreKmsClient.getOrGenerateNewAeadKey(KEY_URI);
            byte[] encrypted = encryption.encrypt(password.getBytes(StandardCharsets.UTF_8),
                key.getBytes(StandardCharsets.UTF_8));
            commit(preferences().edit().putString(key, Base64.encodeToString(encrypted, Base64.NO_WRAP)));
            return new JSObject();
        });
    }

    /** 删除选定账号的密码，保留其账号记录。 */
    @PluginMethod
    public void remove(PluginCall call) {
        execute(call, "remove", () -> {
            commit(preferences().edit().remove(passwordKey(call)));
            return new JSObject();
        });
    }

    /** 清除本应用全部已保存密码，保留账号记录和登录会话。 */
    @PluginMethod
    public void clear(PluginCall call) {
        execute(call, "clear", () -> {
            SharedPreferences.Editor editor = preferences().edit();
            for (String key : preferences().getAll().keySet()) {
                if (key.startsWith(PASSWORD_PREFIX)) editor.remove(key);
            }
            commit(editor);
            return new JSObject();
        });
    }
}
