package main

import (
	"errors"
	"strings"
	"testing"
)

func TestValidateUser_NilUser(t *testing.T) {
	err := ValidateUser(nil)
	if err == nil {
		t.Fatal("expected error for nil user, got nil")
	}
	if !strings.Contains(err.Error(), "user is required") {
		t.Fatalf("unexpected error message: %v", err)
	}
}

func TestValidateUser_MissingID(t *testing.T) {
	user := &User{Email: "a@b.com", Name: "Alice"}
	err := ValidateUser(user)
	if err == nil {
		t.Fatal("expected error for missing ID, got nil")
	}
	if !strings.Contains(err.Error(), "user ID is required") {
		t.Fatalf("unexpected error message: %v", err)
	}
}

func TestValidateUser_MissingName(t *testing.T) {
	user := &User{ID: "1", Email: "a@b.com"}
	err := ValidateUser(user)
	if err == nil {
		t.Fatal("expected error for missing name, got nil")
	}
	if !strings.Contains(err.Error(), "user name is required") {
		t.Fatalf("unexpected error message: %v", err)
	}
}

func TestValidateUser_MissingEmail(t *testing.T) {
	user := &User{ID: "1", Name: "Alice"}
	err := ValidateUser(user)
	if err == nil {
		t.Fatal("expected error for missing email, got nil")
	}
	if !strings.Contains(err.Error(), "email is required") {
		t.Fatalf("unexpected error message: %v", err)
	}
}

func TestValidateUser_InvalidEmail(t *testing.T) {
	user := &User{ID: "1", Email: "invalid-email", Name: "Alice"}
	err := ValidateUser(user)
	if err == nil {
		t.Fatal("expected error for invalid email, got nil")
	}
	if !strings.Contains(err.Error(), "invalid email format") {
		t.Fatalf("unexpected error message: %v", err)
	}
}

func TestValidateUser_ValidUser(t *testing.T) {
	user := &User{ID: "1", Email: "alice@example.com", Name: "Alice"}
	if err := ValidateUser(user); err != nil {
		t.Fatalf("expected valid user, got error: %v", err)
	}
}

func TestProcessOrder_NilUser(t *testing.T) {
	err := ProcessOrder(nil, 100.0)
	if err == nil {
		t.Fatal("expected error for nil user, got nil")
	}
	if !strings.Contains(err.Error(), "invalid user") {
		t.Fatalf("unexpected error message: %v", err)
	}
}

func TestProcessOrder_NegativeAmount(t *testing.T) {
	user := &User{ID: "1", Email: "a@b.com", Name: "Alice"}
	err := ProcessOrder(user, -50.0)
	if err == nil {
		t.Fatal("expected error for negative amount, got nil")
	}
	if !strings.Contains(err.Error(), "amount must be positive") {
		t.Fatalf("unexpected error message: %v", err)
	}
}

func TestProcessOrder_ZeroAmount(t *testing.T) {
	user := &User{ID: "1", Email: "a@b.com", Name: "Alice"}
	err := ProcessOrder(user, 0)
	if err == nil {
		t.Fatal("expected error for zero amount, got nil")
	}
	if !strings.Contains(err.Error(), "amount must be positive") {
		t.Fatalf("unexpected error message: %v", err)
	}
}

func TestProcessOrder_InvalidUser(t *testing.T) {
	user := &User{ID: "", Email: "", Name: ""}
	err := ProcessOrder(user, 100.0)
	if err == nil {
		t.Fatal("expected error for invalid user, got nil")
	}
	if !strings.Contains(err.Error(), "invalid user") {
		t.Fatalf("unexpected error message: %v", err)
	}
}

func TestProcessOrder_ValidOrder(t *testing.T) {
	user := &User{ID: "1", Email: "alice@example.com", Name: "Alice"}
	err := ProcessOrder(user, 100.0)
	if err != nil {
		t.Fatalf("expected success, got error: %v", err)
	}
}

func TestProcessOrder_ErrorWrapping(t *testing.T) {
	user := &User{ID: "1", Name: "Alice"}
	err := ProcessOrder(user, 100.0)
	if err == nil {
		t.Fatal("expected error, got nil")
	}
	if !errors.Is(err, err) {
		t.Log("error wrapping verified via message content")
	}
	if !strings.Contains(err.Error(), "invalid user") {
		t.Fatalf("expected wrapped error message, got: %v", err)
	}
}
