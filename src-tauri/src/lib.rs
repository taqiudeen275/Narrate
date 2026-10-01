// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[cfg(target_os = "android")]
use tauri::Manager;

#[cfg(target_os = "android")]
struct BackgroundState(tauri::plugin::PluginHandle<tauri::Wry>);

#[tauri::command]
async fn begin_background_work(
    app: tauri::AppHandle,
    label: String,
) -> Result<(), String> {
    #[cfg(target_os = "android")]
    app.state::<BackgroundState>().0.run_mobile_plugin::<serde_json::Value>("begin", serde_json::json!({ "label": label }))
        .map_err(|error| error.to_string())?;
    #[cfg(not(target_os = "android"))]
    let _ = (app, label);
    Ok(())
}

#[tauri::command]
async fn end_background_work(
    app: tauri::AppHandle,
) -> Result<(), String> {
    #[cfg(target_os = "android")]
    app.state::<BackgroundState>().0.run_mobile_plugin::<serde_json::Value>("end", ())
        .map_err(|error| error.to_string())?;
    #[cfg(not(target_os = "android"))]
    let _ = app;
    Ok(())
}

#[tauri::command]
async fn audio_export_begin(
    app: tauri::AppHandle,
    filename: String,
    mime_type: String,
    expected_bytes: u64,
) -> Result<serde_json::Value, String> {
    #[cfg(target_os = "android")]
    return app.state::<BackgroundState>().0.run_mobile_plugin_async::<serde_json::Value>(
        "audioExportBegin", serde_json::json!({ "filename": filename, "mimeType": mime_type, "expectedBytes": expected_bytes }),
    ).await.map_err(|error| error.to_string());
    #[cfg(not(target_os = "android"))]
    {
        let _ = (app, filename, mime_type, expected_bytes);
        Ok(serde_json::json!({ "native": false }))
    }
}

#[tauri::command]
async fn audio_export_write(app: tauri::AppHandle, session: String, data: String) -> Result<(), String> {
    if data.len() > 120 * 1024 { return Err("Audio export chunk is too large".into()); }
    #[cfg(target_os = "android")]
    app.state::<BackgroundState>().0.run_mobile_plugin_async::<serde_json::Value>(
        "audioExportWrite", serde_json::json!({ "session": session, "data": data }),
    ).await.map_err(|error| error.to_string())?;
    #[cfg(not(target_os = "android"))]
    let _ = (app, session, data);
    Ok(())
}

#[tauri::command]
async fn audio_export_finish(app: tauri::AppHandle, session: String) -> Result<(), String> {
    #[cfg(target_os = "android")]
    app.state::<BackgroundState>().0.run_mobile_plugin_async::<serde_json::Value>(
        "audioExportFinish", serde_json::json!({ "session": session }),
    ).await.map_err(|error| error.to_string())?;
    #[cfg(not(target_os = "android"))]
    let _ = (app, session);
    Ok(())
}

#[tauri::command]
async fn audio_export_abort(app: tauri::AppHandle, session: String) -> Result<(), String> {
    #[cfg(target_os = "android")]
    app.state::<BackgroundState>().0.run_mobile_plugin_async::<serde_json::Value>(
        "audioExportAbort", serde_json::json!({ "session": session }),
    ).await.map_err(|error| error.to_string())?;
    #[cfg(not(target_os = "android"))]
    let _ = (app, session);
    Ok(())
}
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();
    #[cfg(target_os = "android")]
    let builder = builder.plugin(tauri::plugin::Builder::<tauri::Wry>::new("background")
        .setup(|app, api| {
            let handle = api.register_android_plugin("com.atarq.narrate", "BackgroundPlugin")?;
            app.manage(BackgroundState(handle));
            Ok(())
        }).build());
    builder
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![greet, begin_background_work, end_background_work,
            audio_export_begin, audio_export_write, audio_export_finish, audio_export_abort])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
