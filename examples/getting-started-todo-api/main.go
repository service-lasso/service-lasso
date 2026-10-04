package main

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	_ "github.com/lib/pq"
)

type Todo struct {
	ID    string `json:"id"`
	Title string `json:"title"`
}

func main() {
	port, err := strconv.Atoi(os.Getenv("TODO_API_PORT"))
	if err != nil || port < 1 || port > 65535 {
		log.Fatal("Launch through Lasso with TODO_API_PORT")
	}
	contents, err := os.ReadFile(os.Getenv("TODO_DATABASE_STATE"))
	if err != nil {
		log.Fatal("Start PostgreSQL through Lasso first")
	}
	var state struct {
		Ports map[string]int `json:"ports"`
	}
	if json.Unmarshal(contents, &state) != nil || state.Ports["service"] < 1 {
		log.Fatal("Invalid PostgreSQL runtime allocation")
	}
	db, err := sql.Open("postgres", fmt.Sprintf("host=127.0.0.1 port=%d user=pgadmin password=pgadmin dbname=postgres sslmode=disable connect_timeout=5", state.Ports["service"]))
	if err != nil {
		log.Fatal("Database configuration failed")
	}
	defer db.Close()
	db.SetMaxOpenConns(5)
	ready := false
	for i := 0; i < 100; i++ {
		_, err = db.Exec("CREATE TABLE IF NOT EXISTS tutorial_todos (id text PRIMARY KEY, title text NOT NULL)")
		if err == nil {
			ready = true
			break
		}
		time.Sleep(200 * time.Millisecond)
	}
	if !ready {
		log.Fatal("PostgreSQL not ready; inspect its service logs")
	}
	send := func(w http.ResponseWriter, status int, value any) {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		w.WriteHeader(status)
		json.NewEncoder(w).Encode(value)
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "GET" {
			send(w, 405, map[string]string{"error": "Use GET"})
			return
		}
		if db.PingContext(r.Context()) != nil {
			send(w, 503, map[string]string{"error": "Database unavailable"})
			return
		}
		send(w, 200, map[string]string{"status": "ok"})
	})
	mux.HandleFunc("/todos", func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case "GET":
			rows, err := db.QueryContext(r.Context(), "SELECT id, title FROM tutorial_todos ORDER BY id")
			if err != nil {
				send(w, 503, map[string]string{"error": "Database unavailable"})
				return
			}
			defer rows.Close()
			result := []Todo{}
			for rows.Next() {
				var todo Todo
				if rows.Scan(&todo.ID, &todo.Title) != nil {
					send(w, 500, map[string]string{"error": "Read failed"})
					return
				}
				result = append(result, todo)
			}
			if rows.Err() != nil {
				send(w, 500, map[string]string{"error": "Read failed"})
				return
			}
			send(w, 200, result)
		case "POST":
			if r.Header.Get("Origin") != "" {
				send(w, 403, map[string]string{"error": "Use the Todo UI service proxy"})
				return
			}
			if !strings.HasPrefix(r.Header.Get("Content-Type"), "application/json") {
				send(w, 415, map[string]string{"error": "Use application/json"})
				return
			}
			var input struct {
				Title string `json:"title"`
			}
			decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096))
			if decoder.Decode(&input) != nil || len(strings.TrimSpace(input.Title)) == 0 || len(input.Title) > 200 {
				send(w, 400, map[string]string{"error": "Enter a title of 1–200 bytes"})
				return
			}
			id := make([]byte, 16)
			if _, err := rand.Read(id); err != nil {
				send(w, 500, map[string]string{"error": "Create failed"})
				return
			}
			todo := Todo{hex.EncodeToString(id), strings.TrimSpace(input.Title)}
			if _, err := db.ExecContext(r.Context(), "INSERT INTO tutorial_todos (id, title) VALUES ($1, $2)", todo.ID, todo.Title); err != nil {
				send(w, 503, map[string]string{"error": "Database unavailable"})
				return
			}
			log.Print("Created todo through Go API")
			send(w, 201, todo)
		default:
			send(w, 405, map[string]string{"error": "Use GET or POST"})
		}
	})
	server := &http.Server{Addr: fmt.Sprintf("127.0.0.1:%d", port), Handler: mux, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 10 * time.Second, WriteTimeout: 10 * time.Second, IdleTimeout: 30 * time.Second}
	log.Printf("Managed Go Todo API ready at %s", server.Addr)
	log.Fatal(server.ListenAndServe())
}
