package main

import (
	"embed"
	"fmt"
	"log"
	"net/http"
	"os"
	"runtime"
	"strings"

	"github.com/wailsapp/wails/v3/pkg/application"
)

//go:embed all:frontend/dist
var assets embed.FS

//go:embed assets/branding/tray/tray.png
var trayIcon []byte

func setupApplicationMenu(app *application.App, mainWindow *application.WebviewWindow, updaterSvc *UpdaterService) *application.Menu {
	menu := application.NewMenu()

	if runtime.GOOS == "darwin" {
		pataMenu := menu.AddSubmenu("Pata")
		pataMenu.AddRole(application.About)
		pataMenu.AddSeparator()

		settingsItem := pataMenu.Add("设置…").SetAccelerator("CmdOrCtrl+,")
		settingsItem.OnClick(func(ctx *application.Context) {
			if mainWindow.IsMinimised() {
				mainWindow.UnMinimise()
			}
			mainWindow.Show()
			mainWindow.Focus()
			app.Event.Emit("menu:open-settings")
		})

		checkUpdatesItem := pataMenu.Add("检查更新…")
		checkUpdatesItem.OnClick(func(ctx *application.Context) {
			if mainWindow.IsMinimised() {
				mainWindow.UnMinimise()
			}
			mainWindow.Show()
			mainWindow.Focus()
			updaterSvc.triggerManualCheckFromMenu()
		})

		pataMenu.AddSeparator()
		pataMenu.AddRole(application.ServicesMenu)
		pataMenu.AddSeparator()
		pataMenu.AddRole(application.Hide)
		pataMenu.AddRole(application.HideOthers)
		pataMenu.AddRole(application.UnHide)
		pataMenu.AddSeparator()
		pataMenu.AddRole(application.Quit)
	} else {
		menu.AddRole(application.AppMenu)
	}

	menu.AddRole(application.FileMenu)
	menu.AddRole(application.EditMenu)
	menu.AddRole(application.ViewMenu)
	menu.AddRole(application.WindowMenu)
	menu.AddRole(application.HelpMenu)

	return menu
}

func main() {
	if len(os.Args) > 1 && (os.Args[1] == "--version" || os.Args[1] == "-v" || os.Args[1] == "version") {
		fmt.Printf("Pata %s (official_build: %s)\n", Version, OfficialBuild)
		return
	}

	vaultService := NewVaultService()
	mcpService := newMCPService(vaultService)
	updaterService := NewUpdaterService(vaultService, Version, OfficialBuild == "true")

	app := application.New(application.Options{
		Name:        "Pata",
		Description: "Personal task and note workspace",
		Services: []application.Service{
			application.NewService(vaultService),
			application.NewService(mcpService),
			application.NewService(updaterService),
		},
		Assets: application.AssetOptions{
			Handler: application.AssetFileServerFS(assets),
			Middleware: func(next http.Handler) http.Handler {
				return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					if strings.HasPrefix(r.URL.Path, "/vault-audio/") {
						relPath := strings.TrimPrefix(r.URL.Path, "/vault-audio/")
						absPath, err := vaultService.resolveSafeFilePath(relPath)
						if err != nil {
							http.NotFound(w, r)
							return
						}
						http.ServeFile(w, r, absPath)
						return
					}
					next.ServeHTTP(w, r)
				})
			},
		},
		Mac: application.MacOptions{
			ApplicationShouldTerminateAfterLastWindowClosed: true,
		},
	})

	// Create window with MacTitleBarHiddenInset according to macos-native spec
	mainWindow := app.Window.NewWithOptions(application.WebviewWindowOptions{
		Title:     "Pata",
		Width:     1120,
		Height:    740,
		MinWidth:  800,
		MinHeight: 520,
		Mac: application.MacWindow{
			Backdrop: application.MacBackdropTranslucent,
			TitleBar: application.MacTitleBarHiddenInset,
		},
		BackgroundColour: application.NewRGB(250, 250, 248),
		URL:              "/",
	})

	// Configure macOS standard application menu
	appMenu := setupApplicationMenu(app, mainWindow, updaterService)
	app.Menu.SetApplicationMenu(appMenu)

	// Initialize updater with app
	_ = updaterService.initUpdater(app)

	// Configure static system tray
	tray := app.SystemTray.New()
	tray.SetTemplateIcon(trayIcon)
	tray.SetTooltip("Pata")
	tray.OnClick(func() {
		if mainWindow.IsMinimised() {
			mainWindow.UnMinimise()
		}
		mainWindow.Show()
		mainWindow.Focus()
	})

	err := app.Run()
	if err != nil {
		log.Fatal(err)
	}
}
